import { useQueries, useQuery } from "@tanstack/react-query";
import { ApiRequestError } from "@/shared/api/api-failure";
import {
  getBalance,
  getPayment,
  type Payment,
} from "../api/payments-api";

/** 残額のキーは`["balance", tripId]`（設計書「クエリと再取得」の残額）。 */
export const balanceQueryKey = (tripId: string) =>
  ["balance", tripId] as const;

/** 支払い1件のキーは`["payment", tripId, paymentId]`（支払いの詳細のデータ元）。 */
export const paymentQueryKey = (tripId: string, paymentId: string) =>
  ["payment", tripId, paymentId] as const;

/**
 * 確認の一覧・確認の詳細のキー。支払いの保存が成功したあとに
 * `["settlement-previews", tripId]`・`["settlement-preview", tripId]`の
 * 前方一致で無効化する（開いていないキーは古い印だけ残る）。
 * 精算の画面のPRは同じキー名を使うこと。
 */
export const settlementPreviewsQueryKey = (tripId: string) =>
  ["settlement-previews", tripId] as const;
export const settlementPreviewQueryKey = (tripId: string, previewId: string) =>
  ["settlement-preview", tripId, previewId] as const;

/**
 * 残額（GET /trips/{tripId}/balance）。支払いを記録の画面は
 * `participants`（二人の参加者番号・userId・表示名）だけを使う。
 */
export function useBalance(tripId: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: balanceQueryKey(tripId),
    enabled: options?.enabled ?? true,
    queryFn: () =>
      getBalance(tripId).match(
        (balance) => balance,
        (failure) => {
          throw new ApiRequestError(failure);
        },
      ),
  });
}

/**
 * 支払い1件（GET /trips/{tripId}/payments/{paymentId}）。支払いの詳細の
 * データ元。取り消し状態は`cancellation`に入る。
 */
export function usePayment(
  tripId: string,
  paymentId: string,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: paymentQueryKey(tripId, paymentId),
    enabled: options?.enabled ?? true,
    queryFn: () =>
      getPayment(tripId, paymentId).match(
        (payment) => payment,
        (failure) => {
          throw new ApiRequestError(failure);
        },
      ),
  });
}

/**
 * 支払いIDの一覧を支払いの対応表にする。ホーム・記録の一覧の
 * 支払いの取り消しの行が「〇〇を取り消し」の元の用途を引くときに使う
 * （失敗した支払いは対応表に入れず、呼び出し側の代替表示に任せる）。
 */
export function usePayments(
  tripId: string,
  paymentIds: readonly string[],
): Map<string, Payment> {
  return useQueries({
    queries: paymentIds.map((paymentId) => ({
      queryKey: paymentQueryKey(tripId, paymentId),
      queryFn: () =>
        getPayment(tripId, paymentId).match(
          (payment) => payment,
          (failure) => {
            throw new ApiRequestError(failure);
          },
        ),
    })),
    combine: (results) => {
      const payments = new Map<string, Payment>();
      results.forEach((result, index) => {
        if (result.data !== undefined) {
          payments.set(paymentIds[index] ?? "", result.data);
        }
      });
      return payments;
    },
  });
}
