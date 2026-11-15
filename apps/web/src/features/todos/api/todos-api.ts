import type { ResultAsync } from "neverthrow";
import { z, type ZodType } from "zod";
import type {
  Todo,
  TodoCategory,
  TodoCategoryCreate,
  TodoCategoryDeletion,
  TodoCategoryOrder,
  TodoCategoryPatch,
  TodoCategoryReorder,
  TodoCreate,
  TodoDeletion,
  TodoList,
  TodoPatch,
} from "@tomotabi/contracts";
import { callApi } from "@/shared/api/api-result";
import type { ApiSuccess } from "@/shared/api/api-result";
import type { ApiFailure } from "@/shared/api/api-failure";
import {
  getCompleteTodoUrl,
  getCreateTodoCategoryUrl,
  getCreateTodoUrl,
  getDeleteTodoCategoryUrl,
  getDeleteTodoUrl,
  getReorderTodoCategoriesUrl,
  getReopenTodoUrl,
  getUpdateTodoCategoryUrl,
  getUpdateTodoUrl,
  listTodos as listTodosRequest,
} from "@/shared/api/generated/planning";
import {
  CompleteTodoResponse,
  CreateTodoCategoryResponse,
  CreateTodoResponse,
  DeleteTodoCategoryResponse,
  DeleteTodoResponse,
  ListTodosResponse,
  ReopenTodoResponse,
  ReorderTodoCategoriesResponse,
  UpdateTodoCategoryResponse,
  UpdateTodoResponse,
} from "@/shared/api/generated/planning.zod";
import { sendMutationRequest } from "@/shared/api/mutation-request";
import type {
  MutationDraft,
  MutationRequest,
} from "@/shared/api/mutation-request";

/**
 * ToDoのAPIの薄い入口（設計書 trip-todo「API 設計」）。書き込みはどれも
 * POST・PATCHで、端末に残す仕組み（ADR-0006）にそのまま載せる。
 */

/**
 * deployの前に残した保留要求を再送すると、受領の仕組みが
 * 新しい欄の入る前の古い応答を返す。無い欄はnull・既定値として読む。
 */
function compatTodoBody(value: unknown): unknown {
  if (typeof value !== "object" || value === null) {
    return value;
  }
  const todo = { ...(value as Record<string, unknown>) };
  for (const key of ["categoryId", "assigneeId", "dueOn"] as const) {
    if (todo[key] === undefined) {
      todo[key] = null;
    }
  }
  const plan = todo.plan;
  if (
    typeof plan === "object" &&
    plan !== null &&
    (plan as Record<string, unknown>).name === undefined
  ) {
    todo.plan = { ...(plan as Record<string, unknown>), name: "" };
  }
  return todo;
}

function todoResponse<T>(schema: ZodType<T>): ZodType<T> {
  return z.preprocess(compatTodoBody, schema);
}

export function listTodos(tripId: string): ResultAsync<TodoList, ApiFailure> {
  return callApi(listTodosRequest(tripId), ListTodosResponse);
}

/** 端末に残した保留を「同じ利用者・旅行・操作」で探すための操作名。 */
export const CREATE_TODO_OPERATION = "create-todo";
export const UPDATE_TODO_OPERATION = "update-todo";
export const COMPLETE_TODO_OPERATION = "complete-todo";
export const REOPEN_TODO_OPERATION = "reopen-todo";
export const DELETE_TODO_OPERATION = "delete-todo";

export function createTodoDraft(
  tripId: string,
  name: string,
  categoryId?: string | null,
  planId?: string | null,
): MutationDraft {
  const body: TodoCreate = {
    name,
    ...(categoryId === null || categoryId === undefined
      ? {}
      : { categoryId }),
    ...(planId === null || planId === undefined ? {} : { planId }),
  };
  return {
    operation: CREATE_TODO_OPERATION,
    url: getCreateTodoUrl(tripId),
    method: "POST",
    body,
  };
}

/** PATCHは変えた項目だけを入れる（送っていない = 変えない、memoのnull = 消す）。 */
export function updateTodoDraft(
  tripId: string,
  todoId: string,
  patch: TodoPatch,
  expectedVersion: string,
): MutationDraft {
  return {
    operation: UPDATE_TODO_OPERATION,
    url: getUpdateTodoUrl(tripId, todoId),
    method: "PATCH",
    body: patch,
    expectedVersion,
  };
}

/** 完了の付け外しは版を送らない（相手が名前を直しても競合にしない）。 */
export function completeTodoDraft(
  tripId: string,
  todoId: string,
): MutationDraft {
  return {
    operation: COMPLETE_TODO_OPERATION,
    url: getCompleteTodoUrl(tripId, todoId),
    method: "POST",
    body: null,
  };
}

export function reopenTodoDraft(tripId: string, todoId: string): MutationDraft {
  return {
    operation: REOPEN_TODO_OPERATION,
    url: getReopenTodoUrl(tripId, todoId),
    method: "POST",
    body: null,
  };
}

export function deleteTodoDraft(tripId: string, todoId: string): MutationDraft {
  return {
    operation: DELETE_TODO_OPERATION,
    url: getDeleteTodoUrl(tripId, todoId),
    method: "POST",
    body: null,
  };
}

export function sendCreateTodo(
  request: MutationRequest,
): ResultAsync<ApiSuccess<Todo>, ApiFailure> {
  return sendMutationRequest(request, todoResponse(CreateTodoResponse));
}

export function sendUpdateTodo(
  request: MutationRequest,
): ResultAsync<ApiSuccess<Todo>, ApiFailure> {
  return sendMutationRequest(request, todoResponse(UpdateTodoResponse));
}

export function sendCompleteTodo(
  request: MutationRequest,
): ResultAsync<ApiSuccess<Todo>, ApiFailure> {
  return sendMutationRequest(request, todoResponse(CompleteTodoResponse));
}

export function sendReopenTodo(
  request: MutationRequest,
): ResultAsync<ApiSuccess<Todo>, ApiFailure> {
  return sendMutationRequest(request, todoResponse(ReopenTodoResponse));
}

export function sendDeleteTodo(
  request: MutationRequest,
): ResultAsync<ApiSuccess<TodoDeletion>, ApiFailure> {
  return sendMutationRequest(request, DeleteTodoResponse);
}

/* カテゴリ（設計書 todo-organize「API 設計」）。 */

export const CREATE_TODO_CATEGORY_OPERATION = "create-todo-category";
export const UPDATE_TODO_CATEGORY_OPERATION = "update-todo-category";
export const REORDER_TODO_CATEGORIES_OPERATION = "reorder-todo-categories";
export const DELETE_TODO_CATEGORY_OPERATION = "delete-todo-category";

export function createTodoCategoryDraft(
  tripId: string,
  name: string,
): MutationDraft {
  const body: TodoCategoryCreate = { name };
  return {
    operation: CREATE_TODO_CATEGORY_OPERATION,
    url: getCreateTodoCategoryUrl(tripId),
    method: "POST",
    body,
  };
}

/** 名前の変更は版を送る（相手が先に変えていたら競合にする）。 */
export function updateTodoCategoryDraft(
  tripId: string,
  categoryId: string,
  patch: TodoCategoryPatch,
  expectedVersion: string,
): MutationDraft {
  return {
    operation: UPDATE_TODO_CATEGORY_OPERATION,
    url: getUpdateTodoCategoryUrl(tripId, categoryId),
    method: "PATCH",
    body: patch,
    expectedVersion,
  };
}

/**
 * 並べ替え。`to`は`from`を並べ替えたもの。APIは`to`が今と違う並びに
 * なっていたら（相手が先に動かした）409を返す。
 */
export function reorderTodoCategoriesDraft(
  tripId: string,
  from: string[],
  to: string[],
): MutationDraft {
  const body: TodoCategoryReorder = { from, to };
  return {
    operation: REORDER_TODO_CATEGORIES_OPERATION,
    url: getReorderTodoCategoriesUrl(tripId),
    method: "PUT",
    body,
  };
}

/** 削除。中に入っているToDoも一緒に消えるので、確かめた件数を送る。 */
export function deleteTodoCategoryDraft(
  tripId: string,
  categoryId: string,
  expectedTodoCount: number,
): MutationDraft {
  return {
    operation: DELETE_TODO_CATEGORY_OPERATION,
    url: getDeleteTodoCategoryUrl(tripId, categoryId),
    method: "POST",
    body: { expectedTodoCount },
  };
}

export function sendCreateTodoCategory(
  request: MutationRequest,
): ResultAsync<ApiSuccess<TodoCategory>, ApiFailure> {
  return sendMutationRequest(request, CreateTodoCategoryResponse);
}

export function sendUpdateTodoCategory(
  request: MutationRequest,
): ResultAsync<ApiSuccess<TodoCategory>, ApiFailure> {
  return sendMutationRequest(request, UpdateTodoCategoryResponse);
}

export function sendReorderTodoCategories(
  request: MutationRequest,
): ResultAsync<ApiSuccess<TodoCategoryOrder>, ApiFailure> {
  return sendMutationRequest(request, ReorderTodoCategoriesResponse);
}

export function sendDeleteTodoCategory(
  request: MutationRequest,
): ResultAsync<ApiSuccess<TodoCategoryDeletion>, ApiFailure> {
  return sendMutationRequest(request, DeleteTodoCategoryResponse);
}
