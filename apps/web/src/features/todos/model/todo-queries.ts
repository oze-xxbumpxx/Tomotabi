import { useQuery, type QueryClient } from "@tanstack/react-query";
import type { Todo, TodoList } from "@tomotabi/contracts";
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

/**
 * 保存できたToDoで一覧の同じ項目を置き換える。取り直しを待つあいだに
 * 古い値が一度出ないようにする（並びは取り直しで正す）。
 */
export function replaceTodoInList(
  queryClient: QueryClient,
  tripId: string,
  todo: Todo,
): void {
  queryClient.setQueryData<TodoList>(todosQueryKey(tripId), (list) =>
    list === undefined
      ? list
      : {
          items: list.items.map((item) => (item.id === todo.id ? todo : item)),
        },
  );
}
