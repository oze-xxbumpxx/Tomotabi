import type { ResultAsync } from "neverthrow";
import type { ApiSuccess } from "@/shared/api/api-result";
import { callApi } from "@/shared/api/api-result";
import type { ApiFailure } from "@/shared/api/api-failure";
import {
  getCancelAchievementUrl,
  getCancelBookingUrl,
  getCreateAchievementUrl,
  getCreateBookingUrl,
  listRecords as listRecordsRequest,
} from "@/shared/api/generated/planning";
import {
  CancelAchievementResponse,
  CancelBookingResponse,
  CreateAchievementResponse,
  CreateBookingResponse,
  ListRecordsResponse,
} from "@/shared/api/generated/planning.zod";
import { sendMutationRequest } from "@/shared/api/mutation-request";
import type {
  MutationDraft,
  MutationRequest,
} from "@/shared/api/mutation-request";

/**
 * 記録（支払い・達成・予約とその取り消し）APIの薄い入口。
 * 呼び出しはcallApi / sendMutationRequestを通し、応答は契約のZodで
 * 検証してから返す。生成クライアントとzodへの参照はこの層だけに閉じる。
 * 支払いの詳細・支払いの取り消しは支払いの域なのでfeatures/payments側。
 */

import type {
  Cancellation,
  Event,
  EventCreate,
  EventKind,
  ListRecordsParams,
  ListRecordsType,
  Payment,
  Records,
  TimelineItem,
  TimelineItemKind,
} from "@/shared/api/generated/planning";

// 契約の型はここから再輸出する（model・uiはgeneratedを参照しない）。
export type {
  Cancellation,
  Event,
  EventKind,
  ListRecordsParams,
  ListRecordsType,
  Payment,
  Records,
  TimelineItem,
  TimelineItemKind,
};

/** 達成を記録する操作名（保留中の要求の照合に使う）。 */
export const CREATE_ACHIEVEMENT_OPERATION = "create-achievement";
/** 達成の取り消しの操作名（保留中の要求の照合に使う）。 */
export const CANCEL_ACHIEVEMENT_OPERATION = "cancel-achievement";
/** 予約済みを記録する操作名（保留中の要求の照合に使う）。 */
export const CREATE_BOOKING_OPERATION = "create-booking";
/** 予約の取り消しの操作名（保留中の要求の照合に使う）。 */
export const CANCEL_BOOKING_OPERATION = "cancel-booking";

// ---- 読み取り ----

/**
 * GET /api/trips/{tripId}/records。記録の一覧を新しい順の
 * ページで返す。`recordId`の指定はその記録と取り消しだけを返す
 * 絞り込み（cursor・limitとは組み合わせない。type必須）。
 */
export function listRecordsPage(
  tripId: string,
  params: ListRecordsParams,
): ResultAsync<Records, ApiFailure> {
  return callApi(listRecordsRequest(tripId, params), ListRecordsResponse);
}

// ---- 変更要求の組み立て（MutationDraft） ----

/** POST /api/trips/{tripId}/achievements。If-Matchは付けない。 */
export function createAchievementDraft(
  tripId: string,
  planId: string,
): MutationDraft {
  const body: EventCreate = { planId };
  return {
    operation: CREATE_ACHIEVEMENT_OPERATION,
    url: getCreateAchievementUrl(tripId),
    method: "POST",
    body,
  };
}

/** POST /api/trips/{tripId}/achievements/{recordId}/cancel。If-Matchは付けない。 */
export function cancelAchievementDraft(
  tripId: string,
  recordId: string,
): MutationDraft {
  return {
    operation: CANCEL_ACHIEVEMENT_OPERATION,
    url: getCancelAchievementUrl(tripId, recordId),
    method: "POST",
    body: null,
  };
}

/** POST /api/trips/{tripId}/bookings。If-Matchは付けない。 */
export function createBookingDraft(
  tripId: string,
  planId: string,
): MutationDraft {
  const body: EventCreate = { planId };
  return {
    operation: CREATE_BOOKING_OPERATION,
    url: getCreateBookingUrl(tripId),
    method: "POST",
    body,
  };
}

/** POST /api/trips/{tripId}/bookings/{recordId}/cancel。If-Matchは付けない。 */
export function cancelBookingDraft(
  tripId: string,
  recordId: string,
): MutationDraft {
  return {
    operation: CANCEL_BOOKING_OPERATION,
    url: getCancelBookingUrl(tripId, recordId),
    method: "POST",
    body: null,
  };
}

// ---- 要求の送信（応答を検証して返す） ----

export function sendCreateAchievement(
  request: MutationRequest,
): ResultAsync<ApiSuccess<Event>, ApiFailure> {
  return sendMutationRequest(request, CreateAchievementResponse);
}

export function sendCancelAchievement(
  request: MutationRequest,
): ResultAsync<ApiSuccess<Cancellation>, ApiFailure> {
  return sendMutationRequest(request, CancelAchievementResponse);
}

export function sendCreateBooking(
  request: MutationRequest,
): ResultAsync<ApiSuccess<Event>, ApiFailure> {
  return sendMutationRequest(request, CreateBookingResponse);
}

export function sendCancelBooking(
  request: MutationRequest,
): ResultAsync<ApiSuccess<Cancellation>, ApiFailure> {
  return sendMutationRequest(request, CancelBookingResponse);
}
