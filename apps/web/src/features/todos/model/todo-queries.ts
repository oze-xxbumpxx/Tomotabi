import { useQuery, type QueryClient } from "@tanstack/react-query";
import { ApiRequestError } from "@/shared/api/api-failure";
import { listTodos } from "../api/todos-api";

/** ToDoの一覧のキー。詳細も一覧から1件を取り出して使う。 */
export const todosQueryKey = (tripId: string) => ["todos", tripId] as const;

/** 旅行のToDoの一覧（GET /trips/{tripId}/todos）。 */
export function useTodos(tripId: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: todosQueryKey(tripId),
    enabled: options?.enabled ?? true,
    queryFn: () =>
      listTodos(tripId).match(
        (list) => list,
        (failure) => {
          throw new ApiRequestError(failure);
        },
      ),
  });
}

/** ToDoの書き込みや「予定にする」のあとに、一覧を古いものとして取り直させる。 */
export function invalidateTodos(
  queryClient: QueryClient,
  tripId: string,
): void {
  void queryClient.invalidateQueries({ queryKey: todosQueryKey(tripId) });
}
