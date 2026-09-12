import { integer, pgSchema, text } from "drizzle-orm/pg-core";

export const infraSchema = pgSchema("infra");

export const m0Probes = infraSchema.table("m0_probes", {
  id: text("id").primaryKey(),
  count: integer("count").notNull(),
});
