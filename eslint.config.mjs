import path from "node:path";
import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

const nestForbidden = ["@nestjs/common", "@nestjs/core", "@nestjs/platform-express"];
const dbForbidden = ["drizzle-orm", "pg"];

function restrict(paths, patterns = []) {
  return {
    "no-restricted-imports": [
      "error",
      {
        paths,
        patterns: [
          ...paths.map(({ name, message }) => ({ group: [`${name}/**`], message })),
          ...patterns,
        ],
      },
    ],
  };
}

// Flat config replaces a rule's options; include these in every web layer override.
const webPaths = [
  ...nestForbidden.map((name) => ({
    name,
    message: "web から NestJS を import しない。業務 API は HTTP で呼ぶ。",
  })),
  ...dbForbidden.map((name) => ({
    name,
    message: "web から DB ドライバ / Drizzle を import しない。",
  })),
];
const webPatterns = [
  {
    group: ["**/apps/api/**", "@tomotabi/api", "@tomotabi/api/**"],
    message: "web から apps/api を import しない。契約は @tomotabi/contracts のみ。",
  },
];

const featureBoundaries = {
  rules: {
    "no-cross-feature": {
      meta: { type: "problem", schema: [], messages: { forbidden: "別 feature を直接参照せず、screens で組み合わせる。" } },
      create(context) {
        const filename = context.filename;
        const source = filename.match(/^(.*[/\\]src)[/\\]features[/\\]([^/\\]+)/);
        if (!source) return {};
        function check(node) {
          if (typeof node.source?.value !== "string") return;
          const specifier = node.source.value;
          const target = specifier.startsWith("@/")
            ? path.resolve(source[1], specifier.slice(2))
            : specifier.startsWith(".")
              ? path.resolve(path.dirname(filename), specifier)
              : null;
          if (!target) return;
          const relative = path.relative(path.join(source[1], "features"), target);
          if (!relative.startsWith("..") && relative.split(path.sep)[0] !== source[2]) {
            context.report({ node: node.source, messageId: "forbidden" });
          }
        }
        return { ImportDeclaration: check, ExportNamedDeclaration: check, ExportAllDeclaration: check };
      },
    },
  },
};

export default defineConfig(
  {
    files: ["apps/web/src/features/**/*.{ts,tsx}"],
    plugins: { boundaries: featureBoundaries },
    rules: { "boundaries/no-cross-feature": "error" },
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: [
      "**/dist/**",
      "**/.next/**",
      "**/node_modules/**",
      "logs/**",
      ".claude/**",
      "docs/**",
      "coverage/**",
      "**/tests/fixtures/boundaries/**",
    ],
  },
  {
    files: ["**/*.{js,mjs,cjs,ts,tsx}"],
    languageOptions: {
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: [
      "apps/web/src/**/*.{ts,tsx}",
      "apps/web/tests/fixtures/boundaries/web-imports-pg.ts",
    ],
    rules: restrict(webPaths, webPatterns),
  },
  {
    files: [
      "apps/web/src/shared/**/*.{ts,tsx}",
      "apps/web/tests/fixtures/boundaries/shared-imports-feature.ts",
    ],
    rules: restrict(webPaths, [
      ...webPatterns,
      {
        group: ["@/features/**", "@/screens/**", "@/app/**", "**/features/**", "**/screens/**", "**/app/**"],
        message: "shared から features / screens / app を参照しない。",
      },
    ]),
  },
  {
    files: ["apps/web/src/app/**/*.{ts,tsx}", "apps/web/src/screens/**/*.{ts,tsx}"],
    rules: restrict(webPaths, [
      ...webPatterns,
      {
        group: ["@/features/*/*", "@/features/*/*/**", "**/features/*/*", "**/features/*/*/**"],
        message: "feature の内部（ui / model / api）は import せず、features/<name> の公開入口だけを使う。",
      },
    ]),
  },
  {
    files: [
      "apps/api/src/**/domain/**/*.ts",
      "apps/api/tests/fixtures/boundaries/domain-imports-nestjs.ts",
    ],
    rules: restrict(
      [
        ...nestForbidden.map((name) => ({
          name,
          message: "Domain は NestJS に依存しない。",
        })),
        ...dbForbidden.map((name) => ({
          name,
          message: "Domain は DB に依存しない。",
        })),
      ],
      [
        {
          group: ["express", "express/**", "**/controller/**", "**/usecase/**", "**/infrastructure/**", "**/service/**", "**/adapter/**"],
          message: "Domain は他区分と HTTP / DB 実装に依存しない。",
        },
      ],
    ),
  },
  {
    files: [
      "apps/api/src/**/usecase/**/*.ts",
      "apps/api/tests/fixtures/boundaries/usecase-imports-service.ts",
    ],
    rules: restrict(
      [
        ...nestForbidden.map((name) => ({
          name,
          message: "UseCase に Nest decorator を付けない。IF へ依存する。",
        })),
        ...dbForbidden.map((name) => ({
          name,
          message: "UseCase は Drizzle / pg を直接 import しない。",
        })),
      ],
      [
        {
          group: ["**/infrastructure/**", "../infrastructure/**", "../../infrastructure/**"],
          message: "UseCase は Infrastructure 実装を import せず、Adapter の IF に依存する。",
        },
        {
          group: ["**/modules/*/service/**", "../service/**", "../../service/**"],
          message: "UseCase は Service 実装を import せず、Adapter の Service IF に依存する。",
        },
      ],
    ),
  },
  {
    files: ["apps/api/src/**/service/**/*.ts"],
    rules: restrict(
      [
        ...nestForbidden.map((name) => ({
          name,
          message: "Service は NestJS に依存しない。副作用のない業務計算だけを置く。",
        })),
        ...dbForbidden.map((name) => ({
          name,
          message: "Service は DB に依存しない。",
        })),
      ],
      [
        {
          group: ["express", "**/infrastructure/**", "**/controller/**", "**/usecase/**"],
          message: "Service は HTTP / DB / UseCase に依存しない。",
        },
      ],
    ),
  },
  {
    files: ["apps/api/src/**/adapter/**/*.ts"],
    rules: restrict(
      [
        ...nestForbidden.map((name) => ({
          name,
          message: "Adapter は IF 定義のみ。Nest の型を契約に混ぜない。",
        })),
        ...dbForbidden.map((name) => ({
          name,
          message: "Adapter は Drizzle / pg の型を IF に漏らさない。",
        })),
      ],
      [
        {
          group: [
            "**/infrastructure/**",
            "**/controller/**",
            "**/usecase/**",
            "**/modules/*/service/**",
          ],
          message: "Adapter は実装層を参照しない。",
        },
      ],
    ),
  },
);
