import { ESLint } from "eslint";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../../../..");

describe("import boundaries", () => {
  it("rejects fixture files that violate layer rules", async () => {
    const eslint = new ESLint({ cwd: repoRoot, ignore: false });
    const results = await eslint.lintFiles([
      "apps/api/tests/fixtures/boundaries/usecase-imports-service.ts",
      "apps/api/tests/fixtures/boundaries/domain-imports-nestjs.ts",
      "apps/web/tests/fixtures/boundaries/web-imports-pg.ts",
      "apps/web/tests/fixtures/boundaries/shared-imports-feature.ts",
    ]);

    const byFile = Object.fromEntries(
      results.map((result) => [
        path.relative(repoRoot, result.filePath),
        result.messages.filter((message) => message.ruleId === "no-restricted-imports"),
      ]),
    );

    expect(
      byFile["apps/api/tests/fixtures/boundaries/usecase-imports-service.ts"]?.length,
    ).toBeGreaterThan(0);
    expect(
      byFile["apps/api/tests/fixtures/boundaries/domain-imports-nestjs.ts"]?.length,
    ).toBeGreaterThan(0);
    expect(
      byFile["apps/web/tests/fixtures/boundaries/web-imports-pg.ts"]?.length,
    ).toBeGreaterThan(0);
    expect(
      byFile["apps/web/tests/fixtures/boundaries/shared-imports-feature.ts"]?.length,
    ).toBeGreaterThan(0);
  });
});

const boundaryCases = [
  ["apps/web/src/shared/api/check.ts", "pg", true],
  ["apps/web/src/screens/home/check.ts", "pg", true],
  ["apps/web/src/app/check.ts", "@nestjs/common", true],
  ["apps/web/src/features/foundation/check.ts", "drizzle-orm/node-postgres", true],
  ["apps/api/src/modules/foundation/domain/check.ts", "../service/increment-probe.service", true],
  ["apps/api/src/modules/foundation/domain/check.ts", "drizzle-orm/pg-core", true],
  ["apps/web/src/shared/api/check.ts", "../../features/foundation/ui/probe-panel", true],
  ["apps/web/src/features/other/check.ts", "@/features/foundation/ui/probe-panel", true],
  ["apps/web/src/features/other/model/check.ts", "../../foundation/ui/probe-panel", true],
  ["apps/web/src/screens/home/check.ts", "@/features/foundation/ui/probe-panel", true],
  ["apps/web/src/screens/home/check.ts", "@/features/foundation", false],
  ["apps/web/src/features/foundation/ui/check.ts", "../model/use-probe", false],
  ["apps/web/src/shared/api/check.ts", "@tomotabi/contracts", false],
  ["apps/api/src/modules/foundation/usecase/check.ts", "../adapter/service/increment-probe.port", false],
] as const;

describe("production-path import boundaries", () => {
  const eslint = new ESLint({ cwd: repoRoot });
  it.each(boundaryCases)("%s importing %s (forbidden=%s)", async (filePath, source, forbidden) => {
    // Exercise real source paths: fixture-only configuration can conceal overrides.
    for (const code of [`import * as value from "${source}"; export { value };`, `export * from "${source}";`]) {
      const results = await eslint.lintText(code, { filePath });
      const messages = results.flatMap((result) => result.messages);
      expect(messages.some((message) => message.fatal)).toBe(false);
      const violations = messages.filter((message) =>
        message.ruleId === "no-restricted-imports" || message.ruleId === "boundaries/no-cross-feature",
      );
      expect(violations.length > 0).toBe(forbidden);
    }
  });
});
