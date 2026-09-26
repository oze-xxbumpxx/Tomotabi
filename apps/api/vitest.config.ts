import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    swc.vite({
      jsc: {
        parser: { syntax: "typescript", decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
  test: {
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/**/*.db.test.ts", "node_modules", "dist"],
    coverage: {
      provider: "v8",
      include: ["src/**"],
      exclude: [
        "src/main.ts",
        "src/common/guard/authenticated-request.ts",
        "src/adapter/transaction/unit-of-work.ts",
      ],
      reporter: ["text", "html", "json-summary"],
      reportsDirectory: "./coverage",
    },
  },
});
