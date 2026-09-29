import type { ResultAsync } from "neverthrow";
import type {
  Move,
  Plan,
  PlanCreate,
  PlanPatch,
} from "@tomotabi/contracts";
import { callApi, callApiWithMeta } from "@/shared/api/api-result";
import type { ApiSuccess } from "@/shared/api/api-result";
import type { ApiFailure } from "@/shared/api/api-failure";
import {
  getPlan as getPlanRequest,
  getCreatePlanUrl,
  getUpdatePlanUrl,
  getMovePlanUrl,
  getCancelPlanUrl,
} from "@/shared/api/generated/planning";
import {
  CreatePlanResponse,
  GetPlanResponse,
  UpdatePlanResponse,
  MovePlanResponse,
  CancelPlanResponse,
} from "@/shared/api/generated/planning.zod";
import { sendMutationRequest } from "@/shared/api/mutation-request";
import type {
  MutationDraft,
  MutationRequest,
} from "@/shared/api/mutation-request";

/**
 * 予定 API の薄い入口。呼び出しは callApi / callApiWithMeta /
 * sendMutationRequest を通し、応答は契約の Zod で検証してから返す。
 * 生成クライアントと zod への参照はこの層だけに閉じる。
 */

// ---- 読み取り ----

export function getPlan(
  tripId: string,
  planId: string,
): ResultAsync<Plan, ApiFailure> {
  return callApi(getPlanRequest(tripId, planId), GetPlanResponse);
}

/**
 * GET /api/trips/{tripId}/plans/{planId} の応答全体（ETag つき）。
 * conflict になったとき最新の If-Match を組み立て直すために使う。
 */
export function getPlanWithMeta(
  tripId: string,
  planId: string,
): ResultAsync<ApiSuccess<Plan>, ApiFailure> {
  return callApiWithMeta(getPlanRequest(tripId, planId), GetPlanResponse);
}

// ---- 変更要求の組み立て（MutationDraft） ----

export function createPlanDraft(
  tripId: string,
  values: PlanCreate,
): MutationDraft {
  return {
    operation: "create-plan",
    url: getCreatePlanUrl(tripId),
    method: "POST",
    body: values,
  };
}

/** PATCH は変更のあった項目だけを入れた body で作る（diff は呼び出し側）。 */
export function updatePlanDraft(
  tripId: string,
  planId: string,
  patch: PlanPatch,
  ifMatch: string | null,
): MutationDraft {
  return {
    operation: "update-plan",
    url: getUpdatePlanUrl(tripId, planId),
    method: "PATCH",
    body: patch,
    ifMatch,
  };
}

export function movePlanDraft(
  tripId: string,
  planId: string,
  date: string,
  ifMatch: string | null,
): MutationDraft {
  const body: Move = { date };
  return {
    operation: "move-plan",
    url: getMovePlanUrl(tripId, planId),
    method: "POST",
    body,
    ifMatch,
  };
}

export function cancelPlanDraft(
  tripId: string,
  planId: string,
  ifMatch: string | null,
): MutationDraft {
  return {
    operation: "cancel-plan",
    url: getCancelPlanUrl(tripId, planId),
    method: "POST",
    body: null,
    ifMatch,
  };
}

// ---- 要求の送信（応答を検証して返す） ----

export function sendCreatePlan(
  request: MutationRequest,
): ResultAsync<ApiSuccess<Plan>, ApiFailure> {
  return sendMutationRequest(request, CreatePlanResponse);
}

export function sendUpdatePlan(
  request: MutationRequest,
): ResultAsync<ApiSuccess<Plan>, ApiFailure> {
  return sendMutationRequest(request, UpdatePlanResponse);
}

export function sendMovePlan(
  request: MutationRequest,
): ResultAsync<ApiSuccess<Plan>, ApiFailure> {
  return sendMutationRequest(request, MovePlanResponse);
}

export function sendCancelPlan(
  request: MutationRequest,
): ResultAsync<ApiSuccess<Plan>, ApiFailure> {
  return sendMutationRequest(request, CancelPlanResponse);
}
