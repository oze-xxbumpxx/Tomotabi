import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { Payment } from "../api/payments-api";
import { sendCreatePayment } from "../api/payments-api";
import { useSaveState, type SaveState } from "@/shared/api/save-state";
import type { PendingRequestCheck } from "@/shared/browser/use-pending-request-check";
import {
  balanceQueryKey,
  settlementPreviewsQueryKey,
} from "./payment-queries";

/**
 * useSaveState を支払いの記録に束ねた形。状態の表示は呼び出し側の部品で行う。
 */
export type PaymentSave = ReturnType<typeof useSaveState<Payment, Payment>>;
export type PaymentSaveState = SaveState<Payment, Payment>;

/**
 * 設計書「クエリと再取得」: 支払いを記録・取り消したら、残額・確認の
 * 一覧・その旅行の確認の詳細を取り直す。確認の詳細は previewId を
 * 問わずその旅行のものをまとめて無効化する。
 */
export function invalidatePaymentViews(
  queryClient: QueryClient,
  tripId: string,
): void {
  void queryClient.invalidateQueries({ queryKey: balanceQueryKey(tripId) });
  void queryClient.invalidateQueries({
    queryKey: settlementPreviewsQueryKey(tripId),
  });
  // その旅行の確認の詳細は previewId を問わず前方一致でまとめて無効化する。
  void queryClient.invalidateQueries({
    queryKey: ["settlement-preview", tripId],
  });
}

/**
 * 支払いの記録（POST /trips/{tripId}/payments）。
 * 保留中の要求（ADR-0006）を通す: 送る直前に IndexedDB に保存し、
 * 保存できなければ送らない。`check` が「ある・確認中・確認できない」
 * あいだは新しい Idempotency-Key で保存しない（submit が内側で止める）。
 */
export function useCreatePayment(options: {
  tripId: string;
  userId: string;
  check: PendingRequestCheck;
  onSucceeded?: (result: Payment) => void;
}): PaymentSave {
  const queryClient = useQueryClient();
  return useSaveState<Payment, Payment>({
    send: sendCreatePayment,
    pendingRequest:
      options.userId === ""
        ? null
        : {
            userId: options.userId,
            tripId: options.tripId,
            check: options.check,
          },
    onSucceeded: (result) => {
      invalidatePaymentViews(queryClient, options.tripId);
      options.onSucceeded?.(result.data);
    },
  });
}
