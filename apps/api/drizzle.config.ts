import { defineConfig } from "drizzle-kit";

// Migrations are applied only by an administrator with the migrator role (ADR-0003).
// The runtime DATABASE_URL (app_runtime) must never be used here.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/infrastructure/database/schema/*.ts",
  out: "./drizzle",
  schemaFilter: ["identity"],
  dbCredentials: {
    url: process.env.MIGRATION_DATABASE_URL ?? "",
  },
  strict: true,
  verbose: true,
});
