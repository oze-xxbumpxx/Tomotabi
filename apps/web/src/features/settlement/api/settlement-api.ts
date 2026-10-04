import type { ResultAsync } from "neverthrow";
import { callApi } from "@/shared/api/api-result";
import type { ApiSuccess } from "@/shared/api/api-result";
import type { ApiFailure } from "@/shared/api/api-failure";
import {
  getBalance as getBalanceRequest,
  listSettlementPreviews as listSettlementPreviewsRequest,
  getSettlementPreview as getSettlementPreviewRequest,
  listSettlements as listSettlementsRequest,
  getCreateSettlementPreviewUrl,
  getCompleteSettlementUrl,
} from "@/shared/api/generated/finance";
import type {
  Balance,
  Preview,
  PreviewPage,
  Settlement,
  SettlementCreate,
  SettlementCreateCompletionKind,
  SettlementPage,
} from "@/shared/api/generated/finance";
import {
  GetBalanceResponse,
  CreateSettlementPreviewResponse,
  ListSettlementPreviewsResponse,
  GetSettlementPreviewResponse,
  CompleteSettlementResponse,
  ListSettlementsResponse,
} from "@/shared/api/generated/finance.zod";
import { sendMutationRequest } from "@/shared/api/mutation-request";
import type {
  MutationDraft,
  MutationRequest,
} from "@/shared/api/mutation-request";

// 生成型はapi層でだけ直接importできる。model / ui / screensはここから受け取る。
export type {
  Balance,
  Participant,
  ParticipantSlot,
  Payment,
  Preview,
  PreviewPage,
  PreviewSummary,
  PreviewValidation,
  PreviewValidationStatus,
  Settlement,
  SettlementCreateCompletionKind,
  SettlementPage,
  TargetItem,
  Transfer,
} from "@/shared/api/generated/finance";

/**
 * 精算APIの薄い入口。呼び出しはcallApi / sendMutationRequestを通し、
 * 応答は契約のZodで検証してから返す。生成クライアントとzodへの参照は
 * この層だけに閉じる（features/plansと同じ形）。
 */

// ---- 読み取り ----

/** 残額（向き・金額・対象の件数・明細）。GET /api/trips/{tripId}/balance */
export function getBalance(
  tripId: string,
): ResultAsync<Balance, ApiFailure> {
  return callApi(getBalanceRequest(tripId), GetBalanceResponse);
}

/**
 * 自分の未完了の確認の一覧（GET /api/trips/{tripId}/settlement-previews?status=pending）。
 * `cursor`は前のページの`nextCursor`。
 */
export function listPendingPreviewsPage(
  tripId: string,
  cursor: string | null,
): ResultAsync<PreviewPage, ApiFailure> {
  return callApi(
    listSettlementPreviewsRequest(tripId, {
      status: "pending",
      cursor: cursor ?? undefined,
    }),
    ListSettlementPreviewsResponse,
  );
}

/** 受け渡しの確認1件（元の明細と現在の検証結果）。 */
export function getSettlementPreview(
  tripId: string,
  previewId: string,
): ResultAsync<Preview, ApiFailure> {
  return callApi(
    getSettlementPreviewRequest(tripId, previewId),
    GetSettlementPreviewResponse,
  );
}

/** 精算の履歴（新しい順）。`cursor`は前のページの`nextCursor`。 */
export function listSettlementsPage(
  tripId: string,
  cursor: string | null,
): ResultAsync<SettlementPage, ApiFailure> {
  return callApi(
    listSettlementsRequest(tripId, { cursor: cursor ?? undefined }),
    ListSettlementsResponse,
  );
}

// ---- 変更要求の組み立て（MutationDraft） ----

/** 確認の作成（POST /trips/{tripId}/settlement-previews。body・If-Matchなし）。 */
export function createSettlementPreviewDraft(tripId: string): MutationDraft {
  return {
    operation: "createSettlementPreview",
    url: getCreateSettlementPreviewUrl(tripId),
    method: "POST",
    body: null,
  };
}

/**
 * 精算の完了（POST /trips/{tripId}/settlements）。
 * 非0円は`transfer_completed`、0円は`no_transfer_required`。
 * `acknowledgedCancellationPaymentIds`は、画面で取り消された明細を
 * 確かめたときだけ、その全paymentId。通常は空配列（E-06・E-09）。
 */
export function completeSettlementDraft(
  tripId: string,
  previewId: string,
  completionKind: SettlementCreateCompletionKind,
  acknowledgedCancellationPaymentIds: readonly string[] = [],
): MutationDraft {
  const body: SettlementCreate = {
    previewId,
    completionKind,
    acknowledgedCancellationPaymentIds: [
      ...acknowledgedCancellationPaymentIds,
    ],
  };
  return {
    operation: "completeSettlement",
    url: getCompleteSettlementUrl(tripId),
    method: "POST",
    body,
  };
}

// ---- 要求の送信（応答を検証して返す） ----

export function sendCreateSettlementPreview(
  request: MutationRequest,
): ResultAsync<ApiSuccess<Preview>, ApiFailure> {
  return sendMutationRequest(request, CreateSettlementPreviewResponse);
}

export function sendCompleteSettlement(
  request: MutationRequest,
): ResultAsync<ApiSuccess<Settlement>, ApiFailure> {
  return sendMutationRequest(request, CompleteSettlementResponse);
}
