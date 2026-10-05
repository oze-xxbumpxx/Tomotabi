import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { ResultAsync } from "neverthrow";
import type { ApiFailure } from "@/shared/api/api-failure";
import type { ApiSuccess } from "@/shared/api/api-result";
import type { MutationRequest } from "@/shared/api/mutation-request";
import { useSaveState } from "@/shared/api/save-state";
import type { PendingRequestCheck } from "@/shared/browser/use-pending-request-check";
import type { Cancellation, Event } from "../api/records-api";

/** 達成・予約の記録の保存状態。 */
export type RecordEventSave = ReturnType<typeof useSaveState<Event, Event>>;
/** 記録の取り消しの保存状態。 */
export type RecordCancelSave = ReturnType<
  typeof useSaveState<Cancellation, Cancellation>
>;

/** 送る直前に端末に残す設定。利用者が取れないあいだ（null）は残さない。 */
function pendingOf(input: {
  userId: string | null;
  tripId: string;
  check?: PendingRequestCheck;
}): {
  userId: string;
  tripId: string;
  check?: PendingRequestCheck;
} | null {
  return input.userId === null
    ? null
    : { userId: input.userId, tripId: input.tripId, check: input.check };
}

/**
 * 達成・予約の記録が成功したら、記録の一覧・その予定・その予定に結び
 * ついた支払い・しおり（予定カードの記録の印）を取り直す。
 */
export function invalidateRecordViews(
  queryClient: QueryClient,
  tripId: string,
  planId: string | null,
): void {
  void queryClient.invalidateQueries({ queryKey: ["records", tripId] });
  if (planId !== null) {
    void queryClient.invalidateQueries({
      queryKey: ["plan", tripId, planId],
    });
  }
  void queryClient.invalidateQueries({ queryKey: ["itinerary", tripId] });
}

type OnSaved<T> = (result: ApiSuccess<T>) => void;

function useRecordMutation<T>(options: {
  tripId: string;
  planId: string | null;
  send: (request: MutationRequest) => ResultAsync<ApiSuccess<T>, ApiFailure>;
  userId: string | null;
  check?: PendingRequestCheck;
  onSucceeded?: OnSaved<T>;
}) {
  const queryClient = useQueryClient();
  return useSaveState<T, T>({
    send: options.send,
    pendingRequest: pendingOf({
      userId: options.userId,
      tripId: options.tripId,
      check: options.check,
    }),
    onSucceeded: (result) => {
      invalidateRecordViews(queryClient, options.tripId, options.planId);
      options.onSucceeded?.(result);
    },
  });
}

/**
 * 達成・予約の記録（POST /trips/{tripId}/achievements|bookings）。
 * 送る直前に端末に残し（ADR-0006）、残せなければ送らない。
 */
export function useCreatePlanEvent(options: {
  tripId: string;
  planId: string;
  send: (
    request: MutationRequest,
  ) => ResultAsync<ApiSuccess<Event>, ApiFailure>;
  /** 保留の照合に使う利用者のID。nullのあいだは端末に残さない。 */
  userId: string | null;
  check?: PendingRequestCheck;
  onSucceeded?: OnSaved<Event>;
}): RecordEventSave {
  return useRecordMutation<Event>({
    tripId: options.tripId,
    planId: options.planId,
    send: options.send,
    userId: options.userId,
    check: options.check,
    onSucceeded: options.onSucceeded,
  });
}

/**
 * 達成・予約の取り消し（POST /trips/{tripId}/achievements|bookings/{id}/cancel）。
 */
export function useCancelPlanEvent(options: {
  tripId: string;
  /** 取り直す予定のID（記録が結びついていた予定）。 */
  planId: string | null;
  send: (
    request: MutationRequest,
  ) => ResultAsync<ApiSuccess<Cancellation>, ApiFailure>;
  /** 保留の照合に使う利用者のID。nullのあいだは端末に残さない。 */
  userId: string | null;
  check?: PendingRequestCheck;
  onSucceeded?: OnSaved<Cancellation>;
}): RecordCancelSave {
  return useRecordMutation<Cancellation>({
    tripId: options.tripId,
    planId: options.planId,
    send: options.send,
    userId: options.userId,
    check: options.check,
    onSucceeded: options.onSucceeded,
  });
}
