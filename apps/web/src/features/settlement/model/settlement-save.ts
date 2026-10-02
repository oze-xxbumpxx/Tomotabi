import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type {
  Preview,
  Settlement,
} from "../api/settlement-api";
import type { ApiSuccess } from "@/shared/api/api-result";
import type { PendingRequestCheck } from "@/shared/browser/use-pending-request-check";
import { useSaveState, type SaveState } from "@/shared/api/save-state";
import {
  sendCompleteSettlement,
  sendCreateSettlementPreview,
} from "../api/settlement-api";

/**
 * useSaveState を精算の書き込みに束ねた形。状態の表示は呼び出し側の部品で行う。
 * 確認の作成・精算の完了は保留中の要求を通す（ADR-0006。
 * 送る直前に保存・保存できなければ送らない・成功と確定した拒否で消す・
 * 結果不明では残す）。
 */
export type PreviewSave = ReturnType<typeof useSaveState<Preview, Preview>>;
export type PreviewSaveState = SaveState<Preview, Preview>;
export type SettlementSave = ReturnType<
  typeof useSaveState<Settlement, Settlement>
>;
export type SettlementSaveState = SaveState<Settlement, Settlement>;

type PendingLink = {
  userId: string | null;
  tripId: string;
  check?: PendingRequestCheck;
};

function pendingOf(link: PendingLink) {
  return link.userId === null
    ? null
    : { userId: link.userId, tripId: link.tripId, check: link.check };
}

/**
 * 設計書「クエリと再取得」: 確認の作成が成功したら確認の一覧を取り直す。
 */
export function invalidateSettlementPreviews(
  queryClient: QueryClient,
  tripId: string,
): void {
  void queryClient.invalidateQueries({
    queryKey: ["settlement-previews", tripId],
  });
}

/**
 * 設計書「クエリと再取得」: 精算の完了（・取り消し）が成功したら
 * 残額・確認の一覧・精算の一覧・その確認を取り直す。
 */
export function invalidateSettlementViews(
  queryClient: QueryClient,
  tripId: string,
  previewId: string,
): void {
  void queryClient.invalidateQueries({ queryKey: ["balance", tripId] });
  void queryClient.invalidateQueries({
    queryKey: ["settlement-previews", tripId],
  });
  void queryClient.invalidateQueries({ queryKey: ["settlements", tripId] });
  void queryClient.invalidateQueries({
    queryKey: ["settlement-preview", tripId, previewId],
  });
}

/**
 * 確認の作成（POST /trips/{tripId}/settlement-previews）。
 * `check` に `usePendingRequestCheck`（operation: "createSettlementPreview"）
 * の結果を渡し、保留がある・確認中・確認できないあいだは新しいキーで送らない。
 */
export function useCreateSettlementPreview(options: {
  userId: string | null;
  tripId: string;
  check?: PendingRequestCheck;
  onSucceeded?: ((result: ApiSuccess<Preview>) => void) | null;
}): PreviewSave {
  const queryClient = useQueryClient();
  return useSaveState<Preview, Preview>({
    send: sendCreateSettlementPreview,
    pendingRequest: pendingOf({
      userId: options.userId,
      tripId: options.tripId,
      check: options.check,
    }),
    onSucceeded: (result) => {
      invalidateSettlementPreviews(queryClient, options.tripId);
      options.onSucceeded?.(result);
    },
  });
}

/**
 * 精算の完了（POST /trips/{tripId}/settlements）。
 * `check` に `usePendingRequestCheck`（operation: "completeSettlement"）の
 * 結果を渡す。
 */
export function useCompleteSettlement(options: {
  userId: string | null;
  tripId: string;
  previewId: string;
  check?: PendingRequestCheck;
  onSucceeded?: ((result: ApiSuccess<Settlement>) => void) | null;
}): SettlementSave {
  const queryClient = useQueryClient();
  return useSaveState<Settlement, Settlement>({
    send: sendCompleteSettlement,
    pendingRequest: pendingOf({
      userId: options.userId,
      tripId: options.tripId,
      check: options.check,
    }),
    onSucceeded: (result) => {
      invalidateSettlementViews(
        queryClient,
        options.tripId,
        options.previewId,
      );
      options.onSucceeded?.(result);
    },
  });
}
