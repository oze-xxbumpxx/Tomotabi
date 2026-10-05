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
 * 旅行APIの薄い入口。呼び出しはcallApi / callApiWithMeta / sendMutationRequest
 * を通し、応答は契約のZodで検証してから返す（失敗はApiFailureになる）。
 * 生成クライアントとzodへの参照はこの層だけに閉じる。
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
 * GET /api/trips/{tripId} の応答全体（ETagつき）。
 * conflictになったとき最新のIf-Matchを組み立て直すために使う。
 */
export function getTripWithMeta(
  tripId: string,
): ResultAsync<ApiSuccess<Trip>, ApiFailure> {
  return callApiWithMeta(getTripRequest(tripId), GetTripResponse);
}

/**
 * しおり（GET /api/trips/{tripId}/itinerary）。応答のtripが
 * 旅行ヘッダーのデータ元になる。dateは省略するとサーバーの既定
 * （期間内の今日、期間外なら初日）になり、空文字は絶対に送らない。
 */
export function getTripItinerary(
  tripId: string,
  date?: string | null,
): ResultAsync<Itinerary, ApiFailure> {
  return callApi(
    getItineraryRequest(tripId, {
      date: date === null || date === "" ? undefined : date,
    }),
    GetItineraryResponse,
  );
}

// ---- 変更要求の組み立て（MutationDraft） ----

/**
 * 各書き込みの操作名。端末に残した保留は「同じ利用者・旅行・操作」で
 * 探すので、保留の照合にもこの値を使う。
 */
export const CREATE_TRIP_OPERATION = "create-trip";
export const RENAME_TRIP_OPERATION = "rename-trip";
export const UPDATE_TRIP_PERIOD_OPERATION = "update-trip-period";
export const START_TRIP_OPERATION = "start-trip";
export const FINISH_TRIP_OPERATION = "finish-trip";

export function createTripDraft(values: TripCreate): MutationDraft {
  return {
    operation: CREATE_TRIP_OPERATION,
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
    operation: RENAME_TRIP_OPERATION,
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
    operation: UPDATE_TRIP_PERIOD_OPERATION,
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
    operation: START_TRIP_OPERATION,
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
    operation: FINISH_TRIP_OPERATION,
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
