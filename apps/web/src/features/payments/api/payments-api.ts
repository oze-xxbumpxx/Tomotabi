import type { ResultAsync } from "neverthrow";
import type { ApiSuccess } from "@/shared/api/api-result";
import { callApi } from "@/shared/api/api-result";
import type { ApiFailure } from "@/shared/api/api-failure";
import {
  getBalance as getBalanceRequest,
  getCancelPaymentUrl,
  getCreatePaymentUrl,
  getPayment as getPaymentRequest,
} from "@/shared/api/generated/finance";
import {
  CancelPaymentResponse,
  CreatePaymentResponse,
  GetBalanceResponse,
  GetPaymentResponse,
} from "@/shared/api/generated/finance.zod";
import { sendMutationRequest } from "@/shared/api/mutation-request";
import type {
  MutationDraft,
  MutationRequest,
} from "@/shared/api/mutation-request";

/**
 * 支払い・残額APIの薄い入口。呼び出しはcallApi / sendMutationRequest
 * を通し、応答は契約のZodで検証してから返す。生成クライアントとzod
 * への参照はこの層だけに閉じる。
 */

import type {
  AllocationInput,
  Balance,
  Cancellation,
  Participant,
  Payment,
  PaymentCreate,
} from "@/shared/api/generated/finance";

// 契約の型はここから再輸出する（model・uiはgeneratedを参照しない）。
export type {
  AllocationInput,
  Balance,
  Cancellation,
  Participant,
  Payment,
  PaymentCreate,
};

/** 支払いの記録の操作名（保留中の要求の照合に使う）。 */
export const CREATE_PAYMENT_OPERATION = "create-payment";

/** 支払いの取り消しの操作名（保留中の要求の照合に使う）。 */
export const CANCEL_PAYMENT_OPERATION = "cancel-payment";

// ---- 読み取り ----

/**
 * GET /api/trips/{tripId}/balance。残額と参加者二人
 * （参加者番号・userId・表示名）を返す。支払いの記録の
 * 「払った人」「二人の負担」はこの参加者がデータ元になる。
 */
export function getBalance(
  tripId: string,
): ResultAsync<Balance, ApiFailure> {
  return callApi(getBalanceRequest(tripId), GetBalanceResponse);
}

/**
 * GET /api/trips/{tripId}/payments/{paymentId}。支払い1件（取り消し
 * 状態を含む）。支払いの詳細のデータ元のほか、ホーム・記録の一覧の
 * 取り消しの行の「〇〇を取り消し」の元の用途を調べるときにも使う。
 */
export function getPayment(
  tripId: string,
  paymentId: string,
): ResultAsync<Payment, ApiFailure> {
  return callApi(getPaymentRequest(tripId, paymentId), GetPaymentResponse);
}

// ---- 変更要求の組み立て（MutationDraft） ----

/** POST /api/trips/{tripId}/payments。If-Matchは付けない。 */
export function createPaymentDraft(
  tripId: string,
  body: PaymentCreate,
): MutationDraft {
  return {
    operation: CREATE_PAYMENT_OPERATION,
    url: getCreatePaymentUrl(tripId),
    method: "POST",
    body,
  };
}

/** POST /api/trips/{tripId}/payments/{paymentId}/cancel。If-Matchは付けない。 */
export function cancelPaymentDraft(
  tripId: string,
  paymentId: string,
): MutationDraft {
  return {
    operation: CANCEL_PAYMENT_OPERATION,
    url: getCancelPaymentUrl(tripId, paymentId),
    method: "POST",
    body: null,
  };
}

// ---- 要求の送信（応答を検証して返す） ----

export function sendCreatePayment(
  request: MutationRequest,
): ResultAsync<ApiSuccess<Payment>, ApiFailure> {
  return sendMutationRequest(request, CreatePaymentResponse);
}

export function sendCancelPayment(
  request: MutationRequest,
): ResultAsync<ApiSuccess<Cancellation>, ApiFailure> {
  return sendMutationRequest(request, CancelPaymentResponse);
}
