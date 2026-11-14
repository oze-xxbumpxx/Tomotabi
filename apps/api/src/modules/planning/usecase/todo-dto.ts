import type { Todo as TodoContract } from "@tomotabi/contracts";
import type { Todo } from "../domain/todo.js";
import type { TodoPlanLink } from "../adapter/outbound/todo.repository.js";

export function toTodoDto(todo: Todo, plan: TodoPlanLink | null): TodoContract {
  return {
    id: todo.id,
    tripId: todo.tripId,
    name: todo.name,
    memo: todo.memo,
    createdBy: todo.createdBy,
    createdAt: todo.createdAt.toISOString(),
    doneAt: todo.doneAt === null ? null : todo.doneAt.toISOString(),
    doneBy: todo.doneBy,
    plan: todo.planId === null || plan === null ? null : plan,
    categoryId: todo.categoryId,
    assigneeId: todo.assigneeId,
    dueOn: todo.dueOn,
    version: String(todo.version),
  };
}
