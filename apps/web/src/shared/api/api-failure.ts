/**
 * API が返し得る code の一覧。apps/api の api-error.ts と同じ集合を写す
 * （web は apps/api を import できないため）。未知の文字列は既知の code として
 * 取り出さず、画面に出さない。
 */
export const API_ERROR_CODES = [
  "INVALID_REQUEST",
  "VALIDATION_FAILED",
  "IF_MATCH_REQUIRED",
  "VERSION_CONFLICT",
  "IDEMPOTENCY_KEY_REUSED",
  "PARTICIPANTS_NOT_READY",
  "INVALID_TRIP_TRANSITION",
  "PLAN_OUTSIDE_TRIP_PERIOD",
  "PLAN_HAS_RECORD_HISTORY",
  "PLAN_CANCELLED",
  "TRIP_NOT_ACCESSIBLE",
  "PLAN_NOT_FOUND",
  "PAYMENT_NOT_FOUND",
  "PREVIEW_NOT_FOUND",
  "SETTLEMENT_NOT_FOUND",
  "PREVIEW_CHANGED",
  "CANCELLED_ITEMS_ACK_REQUIRED",
  "TARGET_ALREADY_SETTLED",
  "TARGET_PARTIALLY_SETTLED",
  "SETTLEMENT_NOT_LATEST",
  "NO_SETTLEMENT_TARGET",
  "UNAUTHENTICATED",
  "FORBIDDEN_NOT_ALLOWED",
  "FORBIDDEN_ORIGIN",
  "UNSUPPORTED_MEDIA_TYPE",
  "AUTH_UNAVAILABLE",
  "NOT_FOUND",
  "INTERNAL_ERROR",
  "TEMPORARILY_UNAVAILABLE",
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export function isApiErrorCode(value: unknown): value is ApiErrorCode {
  return (
    typeof value === "string" &&
    (API_ERROR_CODES as readonly string[]).includes(value)
  );
}

// Response bodies and error messages are deliberately not carried: the UI must not display server text.
// http の code だけは分岐に使うために取り出す。message・requestId は持たない。
export type ApiFailure =
  | { kind: "network" }
  | { kind: "http"; status: number; code: ApiErrorCode | null }
  | { kind: "invalid-json" }
  | { kind: "validation" };

export function isApiFailure(value: unknown): value is ApiFailure {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const kind = (value as { kind?: unknown }).kind;
  return (
    kind === "network" ||
    kind === "http" ||
    kind === "invalid-json" ||
    kind === "validation"
  );
}

export class ApiRequestError extends Error {
  constructor(readonly failure: ApiFailure) {
    super(`API request failed: ${failure.kind}`);
    this.name = "ApiRequestError";
  }
}
