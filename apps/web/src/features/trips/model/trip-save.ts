import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { ResultAsync } from "neverthrow";
import type { Trip } from "@tomotabi/contracts";
import type { ApiFailure } from "@/shared/api/api-failure";
import type { ApiSuccess } from "@/shared/api/api-result";
import type { MutationRequest } from "@/shared/api/mutation-request";
import { useSaveState, type SaveState } from "@/shared/api/save-state";
import { NEW_TRIP_ID } from "@/shared/browser/pending-requests";
import type { PendingRequestCheck } from "@/shared/browser/use-pending-request-check";
import { getTripWithMeta, sendCreateTrip } from "../api/trips-api";

/**
 * useSaveStateを旅行の書き込みに束ねた形。状態の表示は呼び出し側の部品で行う。
 */
export type TripSave = ReturnType<typeof useSaveState<Trip, Trip>>;
export type TripSaveState = SaveState<Trip, Trip>;
export type TripSend = (
  request: MutationRequest,
) => ResultAsync<ApiSuccess<Trip>, ApiFailure>;

/** 応答のETag。ヘッダーが無いときは本文のversionから作る（`"3"`の形）。 */
export function etagOf(result: ApiSuccess<{ version: string }>): string {
  return result.etag ?? `"${result.data.version}"`;
}

/**
 * 07 §11: 旅行の名前・期間・状態が変わったら、旅行一覧・旅行・しおりの日付選択を
 * 再取得する。しおりの日付キーはM2-dで`["itinerary", tripId, date]`になる
 * ため、ここでは`["itinerary", tripId]`までの前方一致で無効にする。
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

/** 送る直前に端末に残す設定。利用者が取れないあいだ（null）は残さない。 */
function pendingOf(input: {
  userId: string | null;
  tripId: string;
  check?: PendingRequestCheck;
}): {
  userId: string;
  tripId: string;
  check?: PendingRequestCheck;
} | null {
  return input.userId === null
    ? null
    : { userId: input.userId, tripId: input.tripId, check: input.check };
}

/**
 * 旅行の作成（POST /trips）。If-Matchは付けない。
 * 送る直前に端末に残す要求の旅行のIDは、送る時点でIDが無いので
 * 決まった値`new-trip`を使う（ADR-0006・設計書「端末に残す仕組みの広げ方」）。
 */
export function useCreateTrip(options: {
  /** 保留の照合に使う利用者のID。未ログインのあいだはnull（残さない）。 */
  userId: string | null;
  check?: PendingRequestCheck;
  onSucceeded?: OnTripSaved;
}): TripSave {
  const queryClient = useQueryClient();
  return useSaveState<Trip, Trip>({
    send: sendCreateTrip,
    pendingRequest: pendingOf({
      userId: options.userId,
      tripId: NEW_TRIP_ID,
      check: options.check,
    }),
    onSucceeded: (result) => {
      invalidateTripViews(queryClient, null);
      options.onSucceeded?.(result);
    },
  });
}

/**
 * 旅行への書き込み（名前の変更・期間の変更・開始・終了）。操作ごとに違うのは
 * sendだけ。conflictでは最新の旅行を取り直し、ETagが無い応答でも
 * versionからIf-Matchを組み立て直す。
 */
export function useTripMutation(options: {
  tripId: string;
  send: TripSend;
  /** 保留の照合に使う利用者のID。nullのあいだは端末に残さない。 */
  userId: string | null;
  check?: PendingRequestCheck;
  onSucceeded?: OnTripSaved;
}): TripSave {
  const queryClient = useQueryClient();
  return useSaveState<Trip, Trip>({
    send: options.send,
    pendingRequest: pendingOf({
      userId: options.userId,
      tripId: options.tripId,
      check: options.check,
    }),
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
