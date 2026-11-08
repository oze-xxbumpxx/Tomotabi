"use client";

import { TodoDetailScreen } from "@/screens/todo-detail/todo-detail-screen";

/** ToDoの詳細（設計書 trip-todo）。 */
export function TodoDetailRoute({
  tripId,
  todoId,
}: {
  tripId: string;
  todoId: string;
}) {
  return <TodoDetailScreen tripId={tripId} todoId={todoId} />;
}
