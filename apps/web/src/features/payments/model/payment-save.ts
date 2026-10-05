import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { Cancellation, Payment } from "../api/payments-api";
import { sendCancelPayment, sendCreatePayment } from "../api/payments-api";
import { useSaveState, type SaveState } from "@/shared/api/save-state";
import type { PendingRequestCheck } from "@/shared/browser/use-pending-request-check";
import {
  balanceQueryKey,
  settlementPreviewsQueryKey,
} from "./payment-queries";

/**
 * useSaveStateを支払いの記録に束ねた形。状態の表示は呼び出し側の部品で行う。
 */
export type PaymentSave = ReturnType<typeof useSaveState<Payment, Payment>>;
export type PaymentSaveState = SaveState<Payment, Payment>;

/**
 * 設計書「クエリと再取得」: 支払いを記録・取り消したら、残額・確認の
 * 一覧・その旅行の確認の詳細を取り直す。確認の詳細はpreviewIdを
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
  // その旅行の確認の詳細はpreviewIdを問わず前方一致でまとめて無効化する。
  void queryClient.invalidateQueries({
    queryKey: ["settlement-preview", tripId],
  });
  // 記録の一覧・支払いの詳細・その旅行の支払いも取り直す。
  void queryClient.invalidateQueries({ queryKey: ["records", tripId] });
  void queryClient.invalidateQueries({ queryKey: ["payment", tripId] });
}

/**
 * 支払いの記録（POST /trips/{tripId}/payments）。
 * 保留中の要求（ADR-0006）を通す: 送る直前にIndexedDBに保存し、
 * 保存できなければ送らない。`check`が「ある・確認中・確認できない」
 * あいだは新しいIdempotency-Keyで保存しない（submitが内側で止める）。
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

/** 支払いの取り消しの保存状態。 */
export type PaymentCancelSave = ReturnType<
  typeof useSaveState<Cancellation, Cancellation>
>;

/**
 * 支払いの取り消し（POST /trips/{tripId}/payments/{paymentId}/cancel）。
 * 作成と同じく送る直前に端末に残し（ADR-0006）、残せなければ送らない。
 */
export function useCancelPayment(options: {
  tripId: string;
  /** nullのあいだは端末に残さない。 */
  userId: string | null;
  check?: PendingRequestCheck;
  onSucceeded?: (result: Cancellation) => void;
}): PaymentCancelSave {
  const queryClient = useQueryClient();
  return useSaveState<Cancellation, Cancellation>({
    send: sendCancelPayment,
    pendingRequest:
      options.userId === null
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
