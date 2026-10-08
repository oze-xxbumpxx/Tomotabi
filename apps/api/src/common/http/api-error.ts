/**
 * 設計書「エラー応答」のcode。M1で定義したcodeも変更せずに含める。
 */
export type ApiErrorCode =
  | "INVALID_REQUEST"
  | "VALIDATION_FAILED"
  | "IF_MATCH_REQUIRED"
  | "VERSION_CONFLICT"
  | "IDEMPOTENCY_KEY_REUSED"
  | "PARTICIPANTS_NOT_READY"
  | "INVALID_TRIP_TRANSITION"
  | "PLAN_OUTSIDE_TRIP_PERIOD"
  | "PLAN_HAS_RECORD_HISTORY"
  | "PLAN_CANCELLED"
  | "PLAN_KIND_NOT_SUPPORTED"
  | "RECORD_ALREADY_ACTIVE"
  | "RECORD_NOT_FOUND"
  | "TRIP_NOT_ACCESSIBLE"
  | "PLAN_NOT_FOUND"
  | "PAYMENT_NOT_FOUND"
  | "PREVIEW_NOT_FOUND"
  | "SETTLEMENT_NOT_FOUND"
  | "PREVIEW_CHANGED"
  | "CANCELLED_ITEMS_ACK_REQUIRED"
  | "TARGET_ALREADY_SETTLED"
  | "TARGET_PARTIALLY_SETTLED"
  | "SETTLEMENT_NOT_LATEST"
  | "NO_SETTLEMENT_TARGET"
  | "UNSUPPORTED_PUSH_SERVICE"
  | "INVALID_PUSH_SUBSCRIPTION"
  | "PUSH_ENDPOINT_OWNED_BY_OTHER"
  | "PUSH_LIMIT_REACHED"
  | "PUSH_KEY_CHANGED"
  | "PUSH_SESSION_CLOSED"
  | "PUSH_UNAVAILABLE"
  | "UNAUTHENTICATED"
  | "FORBIDDEN_NOT_ALLOWED"
  | "FORBIDDEN_ORIGIN"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "AUTH_UNAVAILABLE"
  | "NOT_FOUND"
  | "INTERNAL_ERROR"
  | "TEMPORARILY_UNAVAILABLE";

/**
 * 競合の応答に添える任意の詳細（契約のErrorの任意項目）。
 * 利用者が同じ旅行で参照できる行のidだけ入れる。
 */
export type ApiErrorDetails = Readonly<{
  existingSettlementId?: string;
  changedPaymentIds?: readonly string[];
  existingRecordId?: string;
}>;

/**
 * 業務エラー。UseCase・Controllerの境界が投げ、ApiErrorFilterが
 * `{ code, message, requestId, retryable }`の応答に変換する。
 * この型自身はNestに依存しない（UseCaseからも投げられるようにするため）。
 */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly details: ApiErrorDetails;

  constructor(input: {
    code: ApiErrorCode;
    status: number;
    message: string;
    retryable?: boolean;
    details?: ApiErrorDetails;
  }) {
    super(input.message);
    this.name = "ApiError";
    this.code = input.code;
    this.status = input.status;
    this.retryable = input.retryable ?? input.status === 503;
    this.details = input.details ?? {};
  }
}
