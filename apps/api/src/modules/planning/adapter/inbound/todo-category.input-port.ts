import type {
  TodoCategory,
  TodoCategoryDeletion,
  TodoCategoryOrder,
} from "@tomotabi/contracts";
import type { UserId } from "../../../../common/domain/user-id.js";
import type { IdempotencyKey } from "../../../../common/http/idempotency-key.js";
import type { TodoWriteResult } from "./todo.input-port.js";

export const CREATE_TODO_CATEGORY_INPUT_PORT = Symbol(
  "CREATE_TODO_CATEGORY_INPUT_PORT",
);
export const UPDATE_TODO_CATEGORY_INPUT_PORT = Symbol(
  "UPDATE_TODO_CATEGORY_INPUT_PORT",
);
export const REORDER_TODO_CATEGORIES_INPUT_PORT = Symbol(
  "REORDER_TODO_CATEGORIES_INPUT_PORT",
);
export const DELETE_TODO_CATEGORY_INPUT_PORT = Symbol(
  "DELETE_TODO_CATEGORY_INPUT_PORT",
);

export const CREATE_TODO_CATEGORY_OPERATION = "createTodoCategory";
export const UPDATE_TODO_CATEGORY_OPERATION = "updateTodoCategory";
export const REORDER_TODO_CATEGORIES_OPERATION = "reorderTodoCategories";
export const DELETE_TODO_CATEGORY_OPERATION = "deleteTodoCategory";

type Command = Readonly<{
  userId: UserId;
  tripId: string;
  key: IdempotencyKey;
  requestHash: string;
}>;

export type CreateTodoCategoryInput = Command & Readonly<{ name: string }>;
export type UpdateTodoCategoryInput = Command &
  Readonly<{ categoryId: string; ifMatch: string; name: string }>;
export type ReorderTodoCategoriesInput = Command &
  Readonly<{ from: readonly string[]; to: readonly string[] }>;
export type DeleteTodoCategoryInput = Command &
  Readonly<{ categoryId: string; expectedTodoCount: number }>;

export interface CreateTodoCategoryInputPort {
  /**
   * @throws 403 TRIP_NOT_ACCESSIBLE、名前の規則違反は422 VALIDATION_FAILED、
   *   20個あるときは422 TODO_CATEGORY_LIMIT_REACHED。
   */
  execute(
    input: CreateTodoCategoryInput,
  ): Promise<TodoWriteResult<TodoCategory>>;
}

export interface UpdateTodoCategoryInputPort {
  /**
   * @throws 403 TRIP_NOT_ACCESSIBLE、404 TODO_CATEGORY_NOT_FOUND、
   *   409 VERSION_CONFLICT、422 VALIDATION_FAILED。
   */
  execute(
    input: UpdateTodoCategoryInput,
  ): Promise<TodoWriteResult<TodoCategory>>;
}

export interface ReorderTodoCategoriesInputPort {
  /**
   * `from`が今の順と同じときだけ保存する。`to`は`from`の並べ替え。
   * @throws 403 TRIP_NOT_ACCESSIBLE、409 TODO_CATEGORY_ORDER_CHANGED、
   *   422 VALIDATION_FAILED。
   */
  execute(
    input: ReorderTodoCategoriesInput,
  ): Promise<TodoWriteResult<TodoCategoryOrder>>;
}

export interface DeleteTodoCategoryInputPort {
  /**
   * `expectedTodoCount`と保存のときの件数が違えば止める。
   * 同じキーの再送は、行が無くても同じ結果を返す。
   * @throws 403 TRIP_NOT_ACCESSIBLE、404 TODO_CATEGORY_NOT_FOUND、
   *   409 TODO_COUNT_CHANGED。
   */
  execute(
    input: DeleteTodoCategoryInput,
  ): Promise<TodoWriteResult<TodoCategoryDeletion>>;
}
