import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { ResultAsync } from "neverthrow";
import type { Trip } from "@tomotabi/contracts";
import type { ApiFailure } from "@/shared/api/api-failure";
import type { ApiSuccess } from "@/shared/api/api-result";
import type { MutationRequest } from "@/shared/api/mutation-request";
import { useSaveState, type SaveState } from "@/shared/api/save-state";
import { getTripWithMeta, sendCreateTrip } from "../api/trips-api";

/**
 * useSaveState を旅行の書き込みに束ねた形。状態の表示は呼び出し側の部品で行う。
 */
export type TripSave = ReturnType<typeof useSaveState<Trip, Trip>>;
export type TripSaveState = SaveState<Trip, Trip>;
export type TripSend = (
  request: MutationRequest,
) => ResultAsync<ApiSuccess<Trip>, ApiFailure>;

/** 応答の ETag。ヘッダーが無いときは本文の version から作る（`"3"` の形）。 */
export function etagOf(result: ApiSuccess<{ version: string }>): string {
  return result.etag ?? `"${result.data.version}"`;
}

/**
 * 07 §11: 旅行の名前・期間・状態が変わったら、旅行一覧・旅行・しおりの日付選択を
 * 再取得する。しおりの日付キーは M2-d で `["itinerary", tripId, date]` になる
 * ため、ここでは `["itinerary", tripId]` までの前方一致で無効にする。
 */
export function invalidateTripViews(
  queryClient: QueryClient,
  tripId: string | null,
): void {
  void queryClient.invalidateQueries({ queryKey: ["trips"] });
  if (tripId !== null) {
    void queryClient.invalidateQueries({ queryKey: ["trip", tripId] });
    void queryClient.invalidateQueries({ queryKey: ["itinerary", tripId] });
  }
}

type OnTripSaved = (result: ApiSuccess<Trip>) => void;

/** 旅行の作成（POST /trips）。If-Match は付けない。 */
export function useCreateTrip(options?: {
  onSucceeded?: OnTripSaved;
}): TripSave {
  const queryClient = useQueryClient();
  return useSaveState<Trip, Trip>({
    send: sendCreateTrip,
    onSucceeded: (result) => {
      invalidateTripViews(queryClient, null);
      options?.onSucceeded?.(result);
    },
  });
}

/**
 * 旅行への書き込み（名前の変更・期間の変更・開始・終了）。操作ごとに違うのは
 * send だけ。conflict では最新の旅行を取り直し、ETag が無い応答でも
 * version から If-Match を組み立て直す。
 */
export function useTripMutation(options: {
  tripId: string;
  send: TripSend;
  onSucceeded?: OnTripSaved;
}): TripSave {
  const queryClient = useQueryClient();
  return useSaveState<Trip, Trip>({
    send: options.send,
    fetchLatest: () =>
      getTripWithMeta(options.tripId).map((latest) => ({
        ...latest,
        etag: latest.etag ?? `"${latest.data.version}"`,
      })),
    onSucceeded: (result) => {
      invalidateTripViews(queryClient, options.tripId);
      options.onSucceeded?.(result);
    },
  });
}
