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
const mutator = {
  path: "./apps/web/src/shared/api/http-client.ts",
  name: "httpClient",
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
});
