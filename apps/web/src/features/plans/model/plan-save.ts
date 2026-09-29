import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { ResultAsync } from "neverthrow";
import type { Plan } from "@tomotabi/contracts";
import type { ApiFailure } from "@/shared/api/api-failure";
import type { ApiSuccess } from "@/shared/api/api-result";
import type { MutationRequest } from "@/shared/api/mutation-request";
import { useSaveState, type SaveState } from "@/shared/api/save-state";
import {
  getPlanWithMeta,
  sendCreatePlan,
} from "../api/plans-api";

/**
 * useSaveState を予定の書き込みに束ねた形。状態の表示は呼び出し側の部品で行う。
 */
export type PlanSave = ReturnType<typeof useSaveState<Plan, Plan>>;
export type PlanSaveState = SaveState<Plan, Plan>;
export type PlanSend = (
  request: MutationRequest,
) => ResultAsync<ApiSuccess<Plan>, ApiFailure>;

/**
 * 07 §11: 予定の追加・編集・移動・取りやめが成功したら、その予定と
 * しおりを再取得する。しおりの日付キーは `["itinerary", tripId, date]` で、
 * 旧日・新日・既定（date 省略）のどれでも `["itinerary", tripId]` の
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

/** 予定の追加（POST /trips/{tripId}/plans）。If-Match は付けない。 */
export function useCreatePlan(options: {
  tripId: string;
  onSucceeded?: OnPlanSaved;
}): PlanSave {
  const queryClient = useQueryClient();
  return useSaveState<Plan, Plan>({
    send: sendCreatePlan,
    onSucceeded: (result) => {
      invalidatePlanViews(queryClient, options.tripId, null);
      options.onSucceeded?.(result);
    },
  });
}

/**
 * 予定への書き込み（編集・日の移動・取りやめ）。操作ごとに違うのは send だけ。
 * conflict では最新の予定を取り直し、ETag が無い応答でも version から
 * If-Match を組み立て直す。
 */
export function usePlanMutation(options: {
  tripId: string;
  planId: string;
  send: PlanSend;
  onSucceeded?: OnPlanSaved;
}): PlanSave {
  const queryClient = useQueryClient();
  return useSaveState<Plan, Plan>({
    send: options.send,
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
