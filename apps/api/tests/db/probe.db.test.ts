import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IncrementProbeService } from "../../src/modules/foundation/service/increment-probe.service";
import { IncrementProbeUseCase } from "../../src/modules/foundation/usecase/increment-probe.usecase";
import { PgFoundationUnitOfWork } from "../../src/modules/foundation/infrastructure/pg-foundation-unit-of-work";
import { PgProbeRepository } from "../../src/modules/foundation/infrastructure/pg-probe.repository";

describe("foundation PostgreSQL", () => {
  let pool: Pool | undefined;
  let container: Awaited<ReturnType<PostgreSqlContainer["start"]>> | undefined;

  beforeAll(async () => {
    try {
      container = await new PostgreSqlContainer("postgres:16-alpine").start();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Docker is required for Testcontainers. Real PostgreSQL verification is incomplete. Do not substitute PGlite. (${message})`,
      );
    }

    pool = new Pool({ connectionString: container.getConnectionUri() });
    const sql = readFileSync(
      join(__dirname, "../../src/infrastructure/database/sql/m0_probe.sql"),
      "utf8",
    );
    await pool.query(sql);
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  it("starts a real PostgreSQL, increments through IF-based UseCase, and stops the container", async () => {
    if (!pool) {
      throw new Error("PostgreSQL pool was not created");
    }

    const useCase = new IncrementProbeUseCase(
      new PgFoundationUnitOfWork(pool),
      new IncrementProbeService(),
    );
    await expect(useCase.execute()).resolves.toEqual({ count: 1 });

    const current = await new PgProbeRepository(drizzle(pool)).getCount();
    expect(current.value).toBe(1);
  });
});
