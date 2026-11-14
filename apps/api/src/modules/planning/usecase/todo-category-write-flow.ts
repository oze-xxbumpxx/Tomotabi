import type { TodoCategory } from "@tomotabi/contracts";
import type { TodoCategory as TodoCategoryDomain } from "../domain/todo-category.js";
import { ApiError } from "../../../common/http/api-error.js";
import type { WriteLog } from "../adapter/outbound/write-log.port.js";
import type { TodoWriteResult } from "../adapter/inbound/todo.input-port.js";
import type { WriteOutcome } from "./trip-write-flow.js";

/**
 * 参加している旅行の中で、カテゴリが無い・別の旅行のカテゴリはどちらも
 * 同じ404（存在を漏らさない）。
 */
export function todoCategoryNotFound(): ApiError {
  return new ApiError({
    code: "TODO_CATEGORY_NOT_FOUND",
    status: 404,
    message: "Todo category not found",
  });
}

/** カテゴリをDTOにする。 */
export function toTodoCategoryDto(
  category: TodoCategoryDomain,
): TodoCategory {
  return {
    id: category.id,
    tripId: category.tripId,
    name: category.name,
    version: String(category.version),
  };
}

/**
 * カテゴリの書き込み1件のログ。ToDoと同じく結果はcreated / replayed /
 * rejected(code)。カテゴリの名前は書かない（要件B-06）。
 * `resourceId`はrejectedのときの対象id。成功・再送の対象idは`pickResourceId`
 * で返り値から取る（並べ替えの結果にはidが無いため）。
 */
export async function executeTodoCategoryWrite<T>(
  writeLog: WriteLog,
  operation: string,
  tripId: string,
  resourceId: string | null,
  pickResourceId: (body: T) => string,
  work: () => Promise<WriteOutcome<T>>,
): Promise<TodoWriteResult<T>> {
  const startedAt = Date.now();
  try {
    const outcome = await work();
    writeLog.info({
      operation,
      tripId,
      resourceId: pickResourceId(outcome.body),
      result: outcome.replayed ? "replayed" : "created",
      errorCode: null,
      durationMs: Date.now() - startedAt,
    });
    return { httpStatus: outcome.httpStatus, body: outcome.body };
  } catch (error) {
    if (error instanceof ApiError) {
      writeLog.info({
        operation,
        tripId,
        resourceId,
        result: "rejected",
        errorCode: error.code,
        durationMs: Date.now() - startedAt,
      });
    }
    throw error;
  }
}
