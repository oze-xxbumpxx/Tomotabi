import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ApiRequestError } from "@/shared/api/api-failure";
import {
  getBalance,
  getSettlementPreview,
  listPendingPreviewsPage,
  listSettlementsPage,
} from "../api/settlement-api";

export const balanceQueryKey = (tripId: string) =>
  ["balance", tripId] as const;
export const settlementPreviewsQueryKey = (tripId: string) =>
  ["settlement-previews", tripId] as const;
export const settlementPreviewQueryKey = (
  tripId: string,
  previewId: string,
) => ["settlement-preview", tripId, previewId] as const;
export const settlementsQueryKey = (tripId: string) =>
  ["settlements", tripId] as const;

/** 残額（GET /api/trips/{tripId}/balance）。 */
export function useBalance(tripId: string) {
  return useQuery({
    queryKey: balanceQueryKey(tripId),
    queryFn: () =>
      getBalance(tripId).match(
        (balance) => balance,
        (failure) => {
          throw new ApiRequestError(failure);
        },
      ),
  });
}

/** 受け渡しの確認 1 件（元の明細と現在の検証結果）。 */
export function useSettlementPreview(tripId: string, previewId: string) {
  return useQuery({
    queryKey: settlementPreviewQueryKey(tripId, previewId),
    queryFn: () =>
      getSettlementPreview(tripId, previewId).match(
        (preview) => preview,
        (failure) => {
          throw new ApiRequestError(failure);
        },
      ),
  });
}

/**
 * 自分の未完了の確認（新しい順）。20 件を超えるときは
 * 「さらに読み込む」で続きを取る。
 */
export function usePendingSettlementPreviews(tripId: string) {
  return useInfiniteQuery({
    queryKey: settlementPreviewsQueryKey(tripId),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      listPendingPreviewsPage(tripId, pageParam).match(
        (page) => page,
        (failure) => {
          throw new ApiRequestError(failure);
        },
      ),
    getNextPageParam: (page) => page.nextCursor,
  });
}

/** 精算の履歴（新しい順）。20 件を超えるときは「さらに読み込む」で続きを取る。 */
export function useSettlements(tripId: string) {
  return useInfiniteQuery({
    queryKey: settlementsQueryKey(tripId),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      listSettlementsPage(tripId, pageParam).match(
        (page) => page,
        (failure) => {
          throw new ApiRequestError(failure);
        },
      ),
    getNextPageParam: (page) => page.nextCursor,
  });
}
