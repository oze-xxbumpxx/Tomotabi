import { useQueryClient } from "@tanstack/react-query";
import type { ResultAsync } from "neverthrow";
import type { ApiFailure } from "@/shared/api/api-failure";
import type { ApiSuccess } from "@/shared/api/api-result";
import type { MutationRequest } from "@/shared/api/mutation-request";
import { useSaveState, type SaveState } from "@/shared/api/save-state";
import type { PendingRequestCheck } from "@/shared/browser/use-pending-request-check";
import { invalidateTodos } from "./todo-queries";

export type TodoSave<T> = ReturnType<typeof useSaveState<T, T>>;
export type TodoSaveState<T> = SaveState<T, T>;

/**
 * ToDoの書き込み1種類の保存状態。成功したら一覧を取り直す。
 * 送る直前に端末に残し（ADR-0006）、利用者が取れないあいだは残さない。
 */
export function useTodoSave<T>(options: {
  tripId: string;
  userId: string | null;
  send: (request: MutationRequest) => ResultAsync<ApiSuccess<T>, ApiFailure>;
  check?: PendingRequestCheck;
  onSucceeded?: (result: ApiSuccess<T>) => void;
}): TodoSave<T> {
  const queryClient = useQueryClient();
  return useSaveState<T, T>({
    send: options.send,
    pendingRequest:
      options.userId === null
        ? null
        : { userId: options.userId, tripId: options.tripId, check: options.check },
    onSucceeded: (result) => {
      invalidateTodos(queryClient, options.tripId);
      options.onSucceeded?.(result);
    },
  });
}
