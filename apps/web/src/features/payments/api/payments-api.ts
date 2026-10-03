import type { ResultAsync } from "neverthrow";
import type { ApiSuccess } from "@/shared/api/api-result";
import { callApi } from "@/shared/api/api-result";
import type { ApiFailure } from "@/shared/api/api-failure";
import {
  getBalance as getBalanceRequest,
  getCreatePaymentUrl,
} from "@/shared/api/generated/finance";
import {
  CreatePaymentResponse,
  GetBalanceResponse,
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
  Participant,
  Payment,
  PaymentCreate,
} from "@/shared/api/generated/finance";

// 契約の型はここから再輸出する（model・uiはgeneratedを参照しない）。
export type {
  AllocationInput,
  Balance,
  Participant,
  Payment,
  PaymentCreate,
};

/** 支払いの記録の操作名（保留中の要求の照合に使う）。 */
export const CREATE_PAYMENT_OPERATION = "create-payment";

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

// ---- 要求の送信（応答を検証して返す） ----

export function sendCreatePayment(
  request: MutationRequest,
): ResultAsync<ApiSuccess<Payment>, ApiFailure> {
  return sendMutationRequest(request, CreatePaymentResponse);
}
