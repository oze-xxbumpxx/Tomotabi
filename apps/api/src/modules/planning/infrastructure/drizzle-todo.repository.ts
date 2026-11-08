import { and, asc, count, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { BoundedText } from "../../../common/domain/bounded-text.js";
import { UserId } from "../../../common/domain/user-id.js";
import { plans, todos } from "../../../infrastructure/database/schema/planning.js";
import type { Todo } from "../domain/todo.js";
import type {
  NewTodo,
  TodoPlanLink,
  TodoRepository,
  TodoView,
} from "../adapter/outbound/todo.repository.js";

type TodoRow = typeof todos.$inferSelect;

export function toTodoDomain(row: TodoRow): Todo {
  return {
    id: row.id,
    tripId: row.tripId,
    name: row.name as BoundedText,
    memo: row.memo as BoundedText | null,
    createdBy: UserId.parse(row.createdBy),
    createdAt: row.createdAt,
    doneAt: row.doneAt,
    doneBy: row.doneBy === null ? null : UserId.parse(row.doneBy),
    planId: row.planId,
    version: row.version,
    updatedAt: row.updatedAt,
  };
}

/**
 * 旅行のToDoを、未完了 → 完了、それぞれ追加した順で返す（設計書「API 設計」）。
 * つないだ予定の日付と取りやめは同じ問い合わせのLEFT JOINで取る。
 */
export async function listTodoViews(
  db: NodePgDatabase,
  tripId: string,
): Promise<TodoView[]> {
  const rows = await db
    .select({
      todo: todos,
      planId: plans.id,
      planDate: plans.plannedDate,
      planCancelledAt: plans.cancelledAt,
    })
    .from(todos)
    .leftJoin(
      plans,
      and(eq(plans.tripId, todos.tripId), eq(plans.id, todos.planId)),
    )
    .where(eq(todos.tripId, tripId))
    .orderBy(
      sql`(${todos.doneAt} IS NOT NULL)`,
      asc(todos.createdAt),
      asc(todos.id),
    );
  return rows.map((row) => ({
    todo: toTodoDomain(row.todo),
    plan:
      row.planId === null || row.planDate === null
        ? null
        : {
            id: row.planId,
            date: row.planDate,
            cancelled: row.planCancelledAt !== null,
          },
  }));
}

export class DrizzleTodoRepository implements TodoRepository {
  constructor(private readonly db: NodePgDatabase) {}

  async countByTrip(tripId: string): Promise<number> {
    const rows = await this.db
      .select({ value: count() })
      .from(todos)
      .where(eq(todos.tripId, tripId));
    return rows[0]?.value ?? 0;
  }

  async insert(todo: NewTodo): Promise<Todo> {
    const rows = await this.db
      .insert(todos)
      .values({
        tripId: todo.tripId,
        name: todo.name,
        createdBy: todo.createdBy,
      })
      .returning();
    return toTodoDomain(rows[0]!);
  }

  /** 予定と同じく、キー無し列だけの更新なのでFOR NO KEY UPDATEで足りる。 */
  async lockForUpdate(tripId: string, todoId: string): Promise<Todo | null> {
    const rows = await this.db
      .select()
      .from(todos)
      .where(and(eq(todos.tripId, tripId), eq(todos.id, todoId)))
      .for("no key update");
    return rows[0] === undefined ? null : toTodoDomain(rows[0]);
  }

  async update(todo: Todo): Promise<void> {
    await this.db
      .update(todos)
      .set({
        name: todo.name,
        memo: todo.memo,
        doneAt: todo.doneAt,
        doneBy: todo.doneBy,
        planId: todo.planId,
        version: todo.version,
        updatedAt: todo.updatedAt,
      })
      .where(and(eq(todos.tripId, todo.tripId), eq(todos.id, todo.id)));
  }

  async delete(tripId: string, todoId: string): Promise<void> {
    await this.db
      .delete(todos)
      .where(and(eq(todos.tripId, tripId), eq(todos.id, todoId)));
  }

  async planLink(tripId: string, planId: string): Promise<TodoPlanLink | null> {
    const rows = await this.db
      .select({ date: plans.plannedDate, cancelledAt: plans.cancelledAt })
      .from(plans)
      .where(and(eq(plans.tripId, tripId), eq(plans.id, planId)));
    const row = rows[0];
    return row === undefined
      ? null
      : { id: planId, date: row.date, cancelled: row.cancelledAt !== null };
  }
}
