import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { ResultAsync } from "neverthrow";
import type { Plan } from "@tomotabi/contracts";
import type { ApiFailure } from "@/shared/api/api-failure";
import type { ApiSuccess } from "@/shared/api/api-result";
import type { MutationRequest } from "@/shared/api/mutation-request";
import { useSaveState, type SaveState } from "@/shared/api/save-state";
import type { PendingRequestCheck } from "@/shared/browser/use-pending-request-check";
import {
  getPlanWithMeta,
  sendCreatePlan,
} from "../api/plans-api";

/**
 * useSaveStateを予定の書き込みに束ねた形。状態の表示は呼び出し側の部品で行う。
 */
export type PlanSave = ReturnType<typeof useSaveState<Plan, Plan>>;
export type PlanSaveState = SaveState<Plan, Plan>;
export type PlanSend = (
  request: MutationRequest,
) => ResultAsync<ApiSuccess<Plan>, ApiFailure>;

/**
 * 07 §11: 予定の追加・編集・移動・取りやめが成功したら、その予定と
 * しおりを再取得する。しおりの日付キーは`["itinerary", tripId, date]`で、
 * 旧日・新日・既定（date省略）のどれでも`["itinerary", tripId]`の
 * 前方一致でまとめて無効になる（開いていないキーは古い印だけ残る）。
 */
export function invalidatePlanViews(
  queryClient: QueryClient,
  tripId: string,
  planId: string | null,
): void {
  if (planId !== null) {
    void queryClient.invalidateQueries({
      queryKey: ["plan", tripId, planId],
    });
  }
  void queryClient.invalidateQueries({ queryKey: ["itinerary", tripId] });
}

type OnPlanSaved = (result: ApiSuccess<Plan>) => void;

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
 * 予定の追加（POST /trips/{tripId}/plans）。If-Matchは付けない。
 * 送る直前に端末に残し（ADR-0006）、残せなければ送らずに止める。
 */
export function useCreatePlan(options: {
  tripId: string;
  /** 保留の照合に使う利用者のID。nullのあいだは端末に残さない。 */
  userId: string | null;
  check?: PendingRequestCheck;
  onSucceeded?: OnPlanSaved;
}): PlanSave {
  const queryClient = useQueryClient();
  return useSaveState<Plan, Plan>({
    send: sendCreatePlan,
    pendingRequest: pendingOf({
      userId: options.userId,
      tripId: options.tripId,
      check: options.check,
    }),
    onSucceeded: (result) => {
      invalidatePlanViews(queryClient, options.tripId, null);
      options.onSucceeded?.(result);
    },
  });
}

/**
 * 予定への書き込み（編集・日の移動・取りやめ）。操作ごとに違うのはsendだけ。
 * conflictでは最新の予定を取り直し、ETagが無い応答でもversionから
 * If-Matchを組み立て直す。
 */
export function usePlanMutation(options: {
  tripId: string;
  planId: string;
  send: PlanSend;
  /** 保留の照合に使う利用者のID。nullのあいだは端末に残さない。 */
  userId: string | null;
  check?: PendingRequestCheck;
  onSucceeded?: OnPlanSaved;
}): PlanSave {
  const queryClient = useQueryClient();
  return useSaveState<Plan, Plan>({
    send: options.send,
    pendingRequest: pendingOf({
      userId: options.userId,
      tripId: options.tripId,
      check: options.check,
    }),
    fetchLatest: () =>
      getPlanWithMeta(options.tripId, options.planId).map((latest) => ({
        ...latest,
        etag: latest.etag ?? `"${latest.data.version}"`,
      })),
    onSucceeded: (result) => {
      invalidatePlanViews(queryClient, options.tripId, options.planId);
      options.onSucceeded?.(result);
    },
  });
}
