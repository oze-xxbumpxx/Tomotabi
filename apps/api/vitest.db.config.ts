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
    include: ["tests/**/*.db.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
