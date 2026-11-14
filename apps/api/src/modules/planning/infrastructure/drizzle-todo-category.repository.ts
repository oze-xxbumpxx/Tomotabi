import { and, asc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { BoundedText } from "../../../common/domain/bounded-text.js";
import { UserId } from "../../../common/domain/user-id.js";
import { todoCategories } from "../../../infrastructure/database/schema/planning.js";
import type { TodoCategory } from "../domain/todo-category.js";
import type {
  NewTodoCategory,
  TodoCategoryRepository,
} from "../adapter/outbound/todo-category.repository.js";

type TodoCategoryRow = typeof todoCategories.$inferSelect;

export function toTodoCategoryDomain(row: TodoCategoryRow): TodoCategory {
  return {
    id: row.id,
    tripId: row.tripId,
    name: row.name as BoundedText,
    position: row.position,
    createdBy: UserId.parse(row.createdBy),
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** 二人の決めた順（position, createdAt, id）。 */
const LIST_ORDER = [
  asc(todoCategories.position),
  asc(todoCategories.createdAt),
  asc(todoCategories.id),
];

/**
 * 旅行のカテゴリを二人の決めた順で返す。一覧の読み取り（pg-planning-readの
 * REPEATABLE READ読み取り専用トランザクション）がdbハンドルで使い回すため
 * 関数として切り出してある。
 */
export async function listTodoCategories(
  db: NodePgDatabase,
  tripId: string,
): Promise<TodoCategory[]> {
  const rows = await db
    .select()
    .from(todoCategories)
    .where(eq(todoCategories.tripId, tripId))
    .orderBy(...LIST_ORDER);
  return rows.map(toTodoCategoryDomain);
}

export class DrizzleTodoCategoryRepository implements TodoCategoryRepository {
  constructor(private readonly db: NodePgDatabase) {}

  listByTrip(tripId: string): Promise<TodoCategory[]> {
    return listTodoCategories(this.db, tripId);
  }

  async lockAllForUpdate(tripId: string): Promise<TodoCategory[]> {
    const rows = await this.db
      .select()
      .from(todoCategories)
      .where(eq(todoCategories.tripId, tripId))
      .orderBy(...LIST_ORDER)
      .for("update");
    return rows.map(toTodoCategoryDomain);
  }

  async lockForUpdate(
    tripId: string,
    categoryId: string,
  ): Promise<TodoCategory | null> {
    const rows = await this.db
      .select()
      .from(todoCategories)
      .where(
        and(
          eq(todoCategories.tripId, tripId),
          eq(todoCategories.id, categoryId),
        ),
      )
      .for("update");
    return rows[0] === undefined ? null : toTodoCategoryDomain(rows[0]);
  }

  async lockForShare(
    tripId: string,
    categoryId: string,
  ): Promise<TodoCategory | null> {
    const rows = await this.db
      .select()
      .from(todoCategories)
      .where(
        and(
          eq(todoCategories.tripId, tripId),
          eq(todoCategories.id, categoryId),
        ),
      )
      .for("share");
    return rows[0] === undefined ? null : toTodoCategoryDomain(rows[0]);
  }

  async insert(category: NewTodoCategory): Promise<TodoCategory> {
    const rows = await this.db
      .insert(todoCategories)
      .values({
        tripId: category.tripId,
        name: category.name,
        position: category.position,
        createdBy: category.createdBy,
      })
      .returning();
    return toTodoCategoryDomain(rows[0]!);
  }

  async update(category: TodoCategory): Promise<void> {
    await this.db
      .update(todoCategories)
      .set({
        name: category.name,
        position: category.position,
        version: category.version,
        updatedAt: category.updatedAt,
      })
      .where(
        and(
          eq(todoCategories.tripId, category.tripId),
          eq(todoCategories.id, category.id),
        ),
      );
  }

  async updatePositions(
    tripId: string,
    order: readonly string[],
  ): Promise<void> {
    await Promise.all(
      order.map((categoryId, index) =>
        this.db
          .update(todoCategories)
          .set({ position: index })
          .where(
            and(
              eq(todoCategories.tripId, tripId),
              eq(todoCategories.id, categoryId),
            ),
          ),
      ),
    );
  }

  async delete(tripId: string, categoryId: string): Promise<void> {
    await this.db
      .delete(todoCategories)
      .where(
        and(
          eq(todoCategories.tripId, tripId),
          eq(todoCategories.id, categoryId),
        ),
      );
  }
}
