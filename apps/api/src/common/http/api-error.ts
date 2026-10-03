/**
 * 設計書「エラー応答」の code。M1 で定義した code も変更せずに含める。
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
  | "UNAUTHENTICATED"
  | "FORBIDDEN_NOT_ALLOWED"
  | "FORBIDDEN_ORIGIN"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "AUTH_UNAVAILABLE"
  | "NOT_FOUND"
  | "INTERNAL_ERROR"
  | "TEMPORARILY_UNAVAILABLE";

/**
 * 競合の応答に添える任意の詳細（契約の Error の任意項目）。
 * 利用者が同じ旅行で参照できる行の id だけ入れる。
 */
export type ApiErrorDetails = Readonly<{
  existingSettlementId?: string;
  changedPaymentIds?: readonly string[];
}>;

/**
 * 業務エラー。UseCase・Controller の境界が投げ、ApiErrorFilter が
 * `{ code, message, requestId, retryable }` の応答に変換する。
 * この型自身は Nest に依存しない（UseCase からも投げられるようにするため）。
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
