import type {
  Todo,
  TodoDeletion,
  TodoList,
} from "@tomotabi/contracts";
import type { UserId } from "../../../../common/domain/user-id.js";
import type { IdempotencyKey } from "../../../../common/http/idempotency-key.js";

export const LIST_TODOS_INPUT_PORT = Symbol("LIST_TODOS_INPUT_PORT");
export const CREATE_TODO_INPUT_PORT = Symbol("CREATE_TODO_INPUT_PORT");
export const UPDATE_TODO_INPUT_PORT = Symbol("UPDATE_TODO_INPUT_PORT");
export const COMPLETE_TODO_INPUT_PORT = Symbol("COMPLETE_TODO_INPUT_PORT");
export const REOPEN_TODO_INPUT_PORT = Symbol("REOPEN_TODO_INPUT_PORT");
export const DELETE_TODO_INPUT_PORT = Symbol("DELETE_TODO_INPUT_PORT");

export const CREATE_TODO_OPERATION = "createTodo";
export const UPDATE_TODO_OPERATION = "updateTodo";
export const COMPLETE_TODO_OPERATION = "completeTodo";
export const REOPEN_TODO_OPERATION = "reopenTodo";
export const DELETE_TODO_OPERATION = "deleteTodo";

/**
 * ToDoの書き込みUseCaseの結果。receiptに保存したものと同じhttpStatus・bodyを持つ。
 */
export type TodoWriteResult<T = Todo> = Readonly<{
  httpStatus: 200 | 201;
  body: T;
}>;

type Command = Readonly<{
  userId: UserId;
  tripId: string;
  key: IdempotencyKey;
  requestHash: string;
}>;

export type ListTodosInput = Readonly<{ userId: UserId; tripId: string }>;
export type CreateTodoInput = Command & Readonly<{ name: string }>;
export type UpdateTodoInput = Command &
  Readonly<{
    todoId: string;
    ifMatch: string;
    /** undefinedは「送られていない」、nullは「メモを消す」。 */
    name: string | undefined;
    memo: string | null | undefined;
  }>;
export type TodoCommandInput = Command & Readonly<{ todoId: string }>;

export interface ListTodosInputPort {
  /** @throws旅行が無い・参加していないとき403 TRIP_NOT_ACCESSIBLE。 */
  execute(input: ListTodosInput): Promise<TodoList>;
}

export interface CreateTodoInputPort {
  /**
   * @throws 403 TRIP_NOT_ACCESSIBLE、名前の規則違反は422 VALIDATION_FAILED、
   *   200件あるときは422 TODO_LIMIT_REACHED。
   */
  execute(input: CreateTodoInput): Promise<TodoWriteResult>;
}

export interface UpdateTodoInputPort {
  /** @throws 403 TRIP_NOT_ACCESSIBLE、404 TODO_NOT_FOUND、409 VERSION_CONFLICT、422 VALIDATION_FAILED。 */
  execute(input: UpdateTodoInput): Promise<TodoWriteResult>;
}

export interface CompleteTodoInputPort {
  /** 完了済みなら変えずに返す。@throws 403 TRIP_NOT_ACCESSIBLE、404 TODO_NOT_FOUND。 */
  execute(input: TodoCommandInput): Promise<TodoWriteResult>;
}

export interface ReopenTodoInputPort {
  /** 未完了なら変えずに返す。@throws 403 TRIP_NOT_ACCESSIBLE、404 TODO_NOT_FOUND。 */
  execute(input: TodoCommandInput): Promise<TodoWriteResult>;
}

export interface DeleteTodoInputPort {
  /**
   * 同じキーの再送は、行が無くても同じ結果を返す。
   * @throws 403 TRIP_NOT_ACCESSIBLE、404 TODO_NOT_FOUND。
   */
  execute(input: TodoCommandInput): Promise<TodoWriteResult<TodoDeletion>>;
}
