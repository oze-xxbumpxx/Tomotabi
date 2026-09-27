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
  | "UNAUTHENTICATED"
  | "FORBIDDEN_NOT_ALLOWED"
  | "FORBIDDEN_ORIGIN"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "AUTH_UNAVAILABLE"
  | "NOT_FOUND"
  | "INTERNAL_ERROR"
  | "TEMPORARILY_UNAVAILABLE";

/**
 * 業務エラー。UseCase・Controller の境界が投げ、ApiErrorFilter が
 * `{ code, message, requestId, retryable }` の応答に変換する。
 * この型自身は Nest に依存しない（UseCase からも投げられるようにするため）。
 */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly retryable: boolean;

  constructor(input: {
    code: ApiErrorCode;
    status: number;
    message: string;
    retryable?: boolean;
  }) {
    super(input.message);
    this.name = "ApiError";
    this.code = input.code;
    this.status = input.status;
    this.retryable = input.retryable ?? input.status === 503;
  }
}
