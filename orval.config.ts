import { defineConfig } from "orval";

const input = { target: "./packages/contracts/openapi/foundation.json" };
const generatedDir = "./apps/web/src/shared/api/generated";

export default defineConfig({
  foundationClient: {
    input,
    output: {
      mode: "single",
      client: "fetch",
      target: `${generatedDir}/foundation.ts`,
      override: {
        mutator: {
          path: "./apps/web/src/shared/api/http-client.ts",
          name: "httpClient",
        },
      },
    },
  },
  foundationZod: {
    input,
    output: {
      mode: "single",
      client: "zod",
      target: `${generatedDir}/foundation.zod.ts`,
    },
  },
});
