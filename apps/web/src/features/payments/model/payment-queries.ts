import { useQuery } from "@tanstack/react-query";
import { ApiRequestError } from "@/shared/api/api-failure";
import { getBalance } from "../api/payments-api";

/** 残額のキーは`["balance", tripId]`（設計書「クエリと再取得」の残額）。 */
export const balanceQueryKey = (tripId: string) =>
  ["balance", tripId] as const;

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
