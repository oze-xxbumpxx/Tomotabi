"use client";

import { TodosScreen } from "@/screens/todos/todos-screen";

/** ToDoのリスト（設計書 trip-todo）。問い合わせは使わない。 */
export function TodosRoute({ tripId }: { tripId: string }) {
  return <TodosScreen tripId={tripId} />;
}
