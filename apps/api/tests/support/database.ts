import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";

const API_ROOT = join(__dirname, "../..");
export const MIGRATIONS_FOLDER = join(API_ROOT, "drizzle");

const ROLE_PASSWORDS = {
  migrator: "test-migrator",
  app_runtime: "test-app-runtime",
} as const;

export type RoleName = keyof typeof ROLE_PASSWORDS;

export type TestDatabase = {
  container: StartedPostgreSqlContainer;
  admin: Pool;
  urlFor(role: RoleName): string;
  poolFor(role: RoleName): Pool;
  stop(): Promise<void>;
};

export async function startPostgres(): Promise<TestDatabase> {
  let container: StartedPostgreSqlContainer;
  try {
    container = await new PostgreSqlContainer("postgres:16-alpine").start();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Docker is required for Testcontainers. Real PostgreSQL verification is incomplete. Do not substitute PGlite. (${message})`,
    );
  }

  const admin = new Pool({ connectionString: container.getConnectionUri() });
  const pools: Pool[] = [admin];

  const urlFor = (role: RoleName): string => {
    const url = new URL(container.getConnectionUri());
    url.username = role;
    url.password = ROLE_PASSWORDS[role];
    return url.toString();
  };

  return {
    container,
    admin,
    urlFor,
    poolFor(role) {
      const pool = new Pool({ connectionString: urlFor(role) });
      pools.push(pool);
      return pool;
    },
    async stop() {
      await Promise.all(pools.map((pool) => pool.end()));
      await container.stop();
    },
  };
}

// Runs the same administrator script as production, substituting the psql variables.
export async function createRoles(db: TestDatabase): Promise<void> {
  const script = readFileSync(join(API_ROOT, "db/admin/create-roles.sql"), "utf8")
    .replace(":'migrator_password'", `'${ROLE_PASSWORDS.migrator}'`)
    .replace(":'app_runtime_password'", `'${ROLE_PASSWORDS.app_runtime}'`);
  await db.admin.query(script);
}

export async function migrateAsMigrator(db: TestDatabase): Promise<void> {
  const pool = new Pool({ connectionString: db.urlFor("migrator") });
  try {
    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await pool.end();
  }
}
