import type { ResultAsync } from "neverthrow";
import type {
  Itinerary,
  Period,
  Trip,
  TripCreate,
  TripPage,
  TripRename,
  TripStatus,
} from "@tomotabi/contracts";
import { callApi, callApiWithMeta } from "@/shared/api/api-result";
import type { ApiSuccess } from "@/shared/api/api-result";
import type { ApiFailure } from "@/shared/api/api-failure";
import {
  getTrip as getTripRequest,
  listTrips as listTripsRequest,
  getCreateTripUrl,
  getRenameTripUrl,
  getStartTripUrl,
  getFinishTripUrl,
} from "@/shared/api/generated/trips";
import {
  getItinerary as getItineraryRequest,
  getUpdateTripPeriodUrl,
} from "@/shared/api/generated/planning";
import {
  CreateTripResponse,
  GetTripResponse,
  ListTripsResponse,
  RenameTripResponse,
  StartTripResponse,
  FinishTripResponse,
} from "@/shared/api/generated/trips.zod";
import {
  GetItineraryResponse,
  UpdateTripPeriodResponse,
} from "@/shared/api/generated/planning.zod";
import { sendMutationRequest } from "@/shared/api/mutation-request";
import type {
  MutationDraft,
  MutationRequest,
} from "@/shared/api/mutation-request";

/**
 * 旅行 API の薄い入口。呼び出しは callApi / callApiWithMeta / sendMutationRequest
 * を通し、応答は契約の Zod で検証してから返す（失敗は ApiFailure になる）。
 * 生成クライアントと zod への参照はこの層だけに閉じる。
 */

// ---- 読み取り ----

export function listTripsPage(input: {
  status?: TripStatus | null;
  cursor?: string | null;
}): ResultAsync<TripPage, ApiFailure> {
  return callApi(
    listTripsRequest({
      limit: 50,
      status: input.status ?? undefined,
      cursor: input.cursor ?? undefined,
    }),
    ListTripsResponse,
  );
}

export function getTrip(
  tripId: string,
): ResultAsync<Trip, ApiFailure> {
  return callApi(getTripRequest(tripId), GetTripResponse);
}

/**
 * GET /api/trips/{tripId} の応答全体（ETag つき）。
 * conflict になったとき最新の If-Match を組み立て直すために使う。
 */
export function getTripWithMeta(
  tripId: string,
): ResultAsync<ApiSuccess<Trip>, ApiFailure> {
  return callApiWithMeta(getTripRequest(tripId), GetTripResponse);
}

/**
 * しおり（GET /api/trips/{tripId}/itinerary）。応答の trip が
 * 旅行ヘッダーのデータ元になる。日付の選択は M2-d で加える。
 */
export function getTripItinerary(
  tripId: string,
): ResultAsync<Itinerary, ApiFailure> {
  return callApi(getItineraryRequest(tripId), GetItineraryResponse);
}

// ---- 変更要求の組み立て（MutationDraft） ----

export function createTripDraft(values: TripCreate): MutationDraft {
  return {
    operation: "create-trip",
    url: getCreateTripUrl(),
    method: "POST",
    body: values,
  };
}

export function renameTripDraft(
  tripId: string,
  name: string,
  ifMatch: string | null,
): MutationDraft {
  const body: TripRename = { name };
  return {
    operation: "rename-trip",
    url: getRenameTripUrl(tripId),
    method: "PATCH",
    body,
    ifMatch,
  };
}

export function updateTripPeriodDraft(
  tripId: string,
  period: Period,
  ifMatch: string | null,
): MutationDraft {
  return {
    operation: "update-trip-period",
    url: getUpdateTripPeriodUrl(tripId),
    method: "PUT",
    body: period,
    ifMatch,
  };
}

export function startTripDraft(
  tripId: string,
  ifMatch: string | null,
): MutationDraft {
  return {
    operation: "start-trip",
    url: getStartTripUrl(tripId),
    method: "POST",
    body: null,
    ifMatch,
  };
}

export function finishTripDraft(
  tripId: string,
  ifMatch: string | null,
): MutationDraft {
  return {
    operation: "finish-trip",
    url: getFinishTripUrl(tripId),
    method: "POST",
    body: null,
    ifMatch,
  };
}

// ---- 要求の送信（応答を検証して返す） ----

export function sendCreateTrip(
  request: MutationRequest,
): ResultAsync<ApiSuccess<Trip>, ApiFailure> {
  return sendMutationRequest(request, CreateTripResponse);
}

export function sendRenameTrip(
  request: MutationRequest,
): ResultAsync<ApiSuccess<Trip>, ApiFailure> {
  return sendMutationRequest(request, RenameTripResponse);
}

export function sendUpdateTripPeriod(
  request: MutationRequest,
): ResultAsync<ApiSuccess<Trip>, ApiFailure> {
  return sendMutationRequest(request, UpdateTripPeriodResponse);
}

export function sendStartTrip(
  request: MutationRequest,
): ResultAsync<ApiSuccess<Trip>, ApiFailure> {
  return sendMutationRequest(request, StartTripResponse);
}

export function sendFinishTrip(
  request: MutationRequest,
): ResultAsync<ApiSuccess<Trip>, ApiFailure> {
  return sendMutationRequest(request, FinishTripResponse);
}
