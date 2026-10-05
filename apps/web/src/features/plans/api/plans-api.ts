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
 * 予定APIの薄い入口。呼び出しはcallApi / callApiWithMeta /
 * sendMutationRequestを通し、応答は契約のZodで検証してから返す。
 * 生成クライアントとzodへの参照はこの層だけに閉じる。
 */

// ---- 読み取り ----

export function getPlan(
  tripId: string,
  planId: string,
): ResultAsync<Plan, ApiFailure> {
  return callApi(getPlanRequest(tripId, planId), GetPlanResponse);
}

/**
 * GET /api/trips/{tripId}/plans/{planId} の応答全体（ETagつき）。
 * conflictになったとき最新のIf-Matchを組み立て直すために使う。
 */
export function getPlanWithMeta(
  tripId: string,
  planId: string,
): ResultAsync<ApiSuccess<Plan>, ApiFailure> {
  return callApiWithMeta(getPlanRequest(tripId, planId), GetPlanResponse);
}

// ---- 変更要求の組み立て（MutationDraft） ----

/**
 * 各書き込みの操作名。端末に残した保留は「同じ利用者・旅行・操作」で
 * 探すので、保留の照合にもこの値を使う。
 */
export const CREATE_PLAN_OPERATION = "create-plan";
export const UPDATE_PLAN_OPERATION = "update-plan";
export const MOVE_PLAN_OPERATION = "move-plan";
export const CANCEL_PLAN_OPERATION = "cancel-plan";

export function createPlanDraft(
  tripId: string,
  values: PlanCreate,
): MutationDraft {
  return {
    operation: CREATE_PLAN_OPERATION,
    url: getCreatePlanUrl(tripId),
    method: "POST",
    body: values,
  };
}

/** PATCHは変更のあった項目だけを入れたbodyで作る（diffは呼び出し側）。 */
export function updatePlanDraft(
  tripId: string,
  planId: string,
  patch: PlanPatch,
  ifMatch: string | null,
): MutationDraft {
  return {
    operation: UPDATE_PLAN_OPERATION,
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
    operation: MOVE_PLAN_OPERATION,
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
    operation: CANCEL_PLAN_OPERATION,
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
