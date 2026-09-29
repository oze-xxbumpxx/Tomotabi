import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ApiRequestError } from "@/shared/api/api-failure";
import { getTripItinerary, listTripsPage } from "../api/trips-api";

export const tripsListQueryKey = ["trips", "all"] as const;
export const itineraryQueryKey = (tripId: string) =>
  ["itinerary", tripId] as const;

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

/** 旅行ヘッダーのデータ元（itinerary 応答の trip）。M2-d で date を渡す。 */
export function useTripItinerary(tripId: string) {
  return useQuery({
    queryKey: itineraryQueryKey(tripId),
    queryFn: () =>
      getTripItinerary(tripId).match(
        (itinerary) => itinerary,
        (failure) => {
          throw new ApiRequestError(failure);
        },
      ),
  });
}
