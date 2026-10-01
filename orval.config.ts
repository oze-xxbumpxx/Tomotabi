import { defineConfig } from "orval";
import type { OpenApiDocument } from "@orval/core";

const foundationInput = { target: "./packages/contracts/openapi/foundation.json" };
// 認証経路は Better Auth クライアントが呼ぶため、生成対象は /api/me だけに絞る
// （設計書「API 設計」）。契約ファイル自体は 5 操作すべてを定義したままにする。
const authInput = {
  target: "./packages/contracts/openapi/auth.json",
  override: {
    transformer: (spec: OpenApiDocument): OpenApiDocument => ({
      ...spec,
      paths: { "/api/me": spec.paths["/api/me"] },
    }),
  },
};
const generatedDir = "./apps/web/src/shared/api/generated";
const apiGeneratedDir = "./apps/api/src/generated";
const mutator = {
  path: "./apps/web/src/shared/api/http-client.ts",
  name: "httpClient",
};

type JsonSchema = Record<string, unknown> & { $ref?: string };

function isStringSchema(schema: JsonSchema): boolean {
  const type = schema.type;
  return (
    type === "string" ||
    (Array.isArray(type) && type.includes("string"))
  );
}

// 入力側の format: "date" を外す代わりに付ける形だけの検証。
// YYYY-MM-DD の形でない入力は Pipe で 400（設計の「パターン違反は 400」）、
// 形を満たすが実在しない日付は Domain（LocalDate）が 422 にする。
const DATE_SHAPE_PATTERN = "^\\d{4}-\\d{2}-\\d{2}$";

/**
 * 入力検証用の生成にだけ適用する契約の調整（ADR-0004）。
 * Zod の .max() は UTF-16 の長さで数えるため、入力 body の文字列の maxLength を外し、
 * 文字数はコードポイントで数える Domain の値型に任せる（応答側・クエリには残す）。
 * zod.iso.date() は実在日まで検証するため、入力側の format: "date" は
 * 形だけの pattern に置き換え、実在日を含む日付の規則を Domain（LocalDate → 422）に任せる。
 * stripDateFormat=false の応答スキーマでは maxLength だけを外す（format は残す）。
 */
function stripInputConstraints(
  schema: JsonSchema,
  components: Record<string, JsonSchema>,
  seen: Set<string>,
  stripDateFormat: boolean,
): void {
  if (typeof schema.$ref === "string") {
    const name = schema.$ref.replace("#/components/schemas/", "");
    if (seen.has(name) || !(name in components)) {
      return;
    }
    seen.add(name);
    stripInputConstraints(components[name]!, components, seen, stripDateFormat);
    return;
  }
  if (isStringSchema(schema)) {
    delete schema.maxLength;
    if (stripDateFormat && schema.format === "date") {
      delete schema.format;
      schema.pattern = DATE_SHAPE_PATTERN;
    }
  }
  const properties = schema.properties;
  if (typeof properties === "object" && properties !== null) {
    for (const value of Object.values(properties)) {
      if (typeof value === "object" && value !== null) {
        stripInputConstraints(value as JsonSchema, components, seen, stripDateFormat);
      }
    }
  }
  for (const key of ["items", "additionalProperties"] as const) {
    const value = schema[key];
    if (typeof value === "object" && value !== null) {
      stripInputConstraints(value as JsonSchema, components, seen, stripDateFormat);
    }
  }
  for (const key of ["oneOf", "anyOf", "allOf"] as const) {
    const value = schema[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "object" && item !== null) {
          stripInputConstraints(item as JsonSchema, components, seen, stripDateFormat);
        }
      }
    }
  }
}

function stripDateFormatFromQuery(
  spec: OpenApiDocument,
): void {
  const parameters = spec.components?.parameters ?? {};
  for (const pathItem of Object.values(spec.paths ?? {})) {
    if (typeof pathItem !== "object" || pathItem === null) {
      continue;
    }
    for (const operation of Object.values(pathItem)) {
      if (typeof operation !== "object" || operation === null) {
        continue;
      }
      const params = (operation as { parameters?: unknown }).parameters;
      if (!Array.isArray(params)) {
        continue;
      }
      for (const param of params) {
        if (typeof param !== "object" || param === null) {
          continue;
        }
        const resolved =
          "$ref" in param && typeof param.$ref === "string"
            ? parameters[param.$ref.replace("#/components/parameters/", "")]
            : param;
        if (typeof resolved !== "object" || resolved === null) {
          continue;
        }
        const { schema } = resolved as { schema?: JsonSchema; in?: unknown };
        if (
          (resolved as { in?: unknown }).in === "query" &&
          typeof schema === "object" &&
          schema !== null &&
          isStringSchema(schema) &&
          schema.format === "date"
        ) {
          delete schema.format;
          schema.pattern = DATE_SHAPE_PATTERN;
        }
      }
    }
  }
}

const stripRequestInputConstraints = (
  spec: OpenApiDocument,
): OpenApiDocument => {
  const clone = structuredClone(spec) as OpenApiDocument;
  const components = (clone.components?.schemas ?? {}) as Record<
    string,
    JsonSchema
  >;
  for (const pathItem of Object.values(clone.paths ?? {})) {
    if (typeof pathItem !== "object" || pathItem === null) {
      continue;
    }
    for (const operation of Object.values(pathItem)) {
      if (typeof operation !== "object" || operation === null) {
        continue;
      }
      const requestBody = (operation as { requestBody?: unknown }).requestBody;
      if (typeof requestBody !== "object" || requestBody === null) {
        continue;
      }
      const content = (requestBody as { content?: unknown }).content;
      if (typeof content !== "object" || content === null) {
        continue;
      }
      for (const mediaType of Object.values(content)) {
        const schema = (mediaType as { schema?: unknown }).schema;
        if (typeof schema === "object" && schema !== null) {
          stripInputConstraints(schema as JsonSchema, components, new Set(), true);
        }
      }
    }
  }
  stripDateFormatFromQuery(clone);
  return clone;
};

/**
 * web の検証用 zod 生成にだけ追加で適用する調整。
 * 応答側の文字列 maxLength も外す。Zod の .max() は UTF-16 で数えるため、
 * 契約（コードポイント）に従った有効な応答（絵文字を含む名前など）を
 * callApi の検証が誤って弾いてしまう。契約の maxLength 自体は残す。
 */
const stripResponseStringMaxLength = (
  spec: OpenApiDocument,
): OpenApiDocument => {
  const clone = structuredClone(spec) as OpenApiDocument;
  const components = (clone.components?.schemas ?? {}) as Record<
    string,
    JsonSchema
  >;
  for (const pathItem of Object.values(clone.paths ?? {})) {
    if (typeof pathItem !== "object" || pathItem === null) {
      continue;
    }
    for (const operation of Object.values(pathItem)) {
      if (typeof operation !== "object" || operation === null) {
        continue;
      }
      const responses = (operation as { responses?: unknown }).responses;
      if (typeof responses !== "object" || responses === null) {
        continue;
      }
      for (const response of Object.values(responses)) {
        const content = (response as { content?: unknown })?.content;
        if (typeof content !== "object" || content === null) {
          continue;
        }
        for (const mediaType of Object.values(content)) {
          const schema = (mediaType as { schema?: unknown }).schema;
          if (typeof schema === "object" && schema !== null) {
            stripInputConstraints(schema as JsonSchema, components, new Set(), false);
          }
        }
      }
    }
  }
  return clone;
};

const stripWebValidationConstraints = (spec: OpenApiDocument): OpenApiDocument =>
  stripResponseStringMaxLength(stripRequestInputConstraints(spec));

// 入力検証用の Zod（web 側のフォーム検証と API の Pipe で共用する生成設定）
const validationZod = {
  strict: { body: true, query: true },
  coerce: { query: true },
} as const;

const tripsInput = {
  target: "./packages/contracts/openapi/trips.json",
  override: { transformer: stripRequestInputConstraints },
};
const tripsWebInput = {
  target: "./packages/contracts/openapi/trips.json",
  override: { transformer: stripWebValidationConstraints },
};
const planningInput = {
  target: "./packages/contracts/openapi/planning.json",
  override: { transformer: stripRequestInputConstraints },
};
const planningWebInput = {
  target: "./packages/contracts/openapi/planning.json",
  override: { transformer: stripWebValidationConstraints },
};
const financeInput = {
  target: "./packages/contracts/openapi/finance.json",
  override: { transformer: stripRequestInputConstraints },
};
const financeWebInput = {
  target: "./packages/contracts/openapi/finance.json",
  override: { transformer: stripWebValidationConstraints },
};

export default defineConfig({
  foundationClient: {
    input: foundationInput,
    output: {
      mode: "single",
      client: "fetch",
      target: `${generatedDir}/foundation.ts`,
      override: { mutator },
    },
  },
  foundationZod: {
    input: foundationInput,
    output: {
      mode: "single",
      client: "zod",
      target: `${generatedDir}/foundation.zod.ts`,
    },
  },
  authClient: {
    input: authInput,
    output: {
      mode: "single",
      client: "fetch",
      target: `${generatedDir}/auth.ts`,
      override: { mutator },
    },
  },
  authZod: {
    input: authInput,
    output: {
      mode: "single",
      client: "zod",
      target: `${generatedDir}/auth.zod.ts`,
    },
  },
  tripsClient: {
    input: { target: tripsInput.target },
    output: {
      mode: "single",
      client: "fetch",
      target: `${generatedDir}/trips.ts`,
      override: { mutator },
    },
  },
  tripsZod: {
    input: tripsWebInput,
    output: {
      mode: "single",
      client: "zod",
      target: `${generatedDir}/trips.zod.ts`,
      override: { zod: validationZod },
    },
  },
  tripsApiZod: {
    input: tripsInput,
    output: {
      mode: "single",
      client: "zod",
      target: `${apiGeneratedDir}/trips.zod.ts`,
      override: { zod: validationZod },
    },
  },
  planningClient: {
    input: { target: planningInput.target },
    output: {
      mode: "single",
      client: "fetch",
      target: `${generatedDir}/planning.ts`,
      override: { mutator },
    },
  },
  planningZod: {
    input: planningWebInput,
    output: {
      mode: "single",
      client: "zod",
      target: `${generatedDir}/planning.zod.ts`,
      override: { zod: validationZod },
    },
  },
  planningApiZod: {
    input: planningInput,
    output: {
      mode: "single",
      client: "zod",
      target: `${apiGeneratedDir}/planning.zod.ts`,
      override: { zod: validationZod },
    },
  },
  financeClient: {
    input: { target: financeInput.target },
    output: {
      mode: "single",
      client: "fetch",
      target: `${generatedDir}/finance.ts`,
      override: { mutator },
    },
  },
  financeZod: {
    input: financeWebInput,
    output: {
      mode: "single",
      client: "zod",
      target: `${generatedDir}/finance.zod.ts`,
      override: { zod: validationZod },
    },
  },
  financeApiZod: {
    input: financeInput,
    output: {
      mode: "single",
      client: "zod",
      target: `${apiGeneratedDir}/finance.zod.ts`,
      override: { zod: validationZod },
    },
  },
});
