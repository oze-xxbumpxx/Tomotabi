import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ApiRequestError } from "@/shared/api/api-failure";
import { getTrip, getTripItinerary, listTripsPage } from "../api/trips-api";

export const tripsListQueryKey = ["trips", "all"] as const;
export const tripQueryKey = (tripId: string) => ["trip", tripId] as const;
/**
 * しおりのキーは `["itinerary", tripId, date]`。URL で date が省略された
 * 取得は `date = null` のキーに入る（サーバー既定の日）。
 * `["itinerary", tripId]` の前方一致 invalidate はこのまま効く。
 */
export const itineraryQueryKey = (tripId: string, date: string | null = null) =>
  ["itinerary", tripId, date] as const;

/**
 * 旅行の一覧。再取得中は前回の表示を残し、失敗は前回表示に添える
 * （07 §3）。50 件を超えるときは「さらに読み込む」で続きを取る。
 */
export function useTripList() {
  return useInfiniteQuery({
    queryKey: tripsListQueryKey,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      listTripsPage({ cursor: pageParam }).match(
        (page) => page,
        (failure) => {
          throw new ApiRequestError(failure);
        },
      ),
    getNextPageParam: (page) => page.nextCursor,
  });
}

/**
 * 旅行 1 件（GET /trips/{tripId}）。期間の日付選択が必要な画面
 * （期間外の案内・予定の追加・日の移動）で使う。
 */
export function useTrip(tripId: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: tripQueryKey(tripId),
    enabled: options?.enabled ?? true,
    queryFn: () =>
      getTrip(tripId).match(
        (trip) => trip,
        (failure) => {
          throw new ApiRequestError(failure);
        },
      ),
  });
}

/**
 * しおり（itinerary 応答は trip を含み、旅行ヘッダーのデータ元になる）。
 * `date` は URL の date をそのまま渡し、省略時は null（サーバー既定）。
 */
export function useTripItinerary(tripId: string, date: string | null = null) {
  return useQuery({
    queryKey: itineraryQueryKey(tripId, date),
    queryFn: () =>
      getTripItinerary(tripId, date).match(
        (itinerary) => itinerary,
        (failure) => {
          throw new ApiRequestError(failure);
        },
      ),
  });
}
