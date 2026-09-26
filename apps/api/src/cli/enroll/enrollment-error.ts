export type EnrollmentErrorCode =
  | "STATE_MISMATCH"
  | "NONCE_MISMATCH"
  | "AUTHORIZATION_DENIED"
  | "CALLBACK_TIMEOUT"
  | "ID_TOKEN_MISSING"
  | "ID_TOKEN_INVALID"
  | "CANCELLED";

/**
 * 初期登録の中止理由。message には code・トークン・sub を含めない（そのまま標準出力に出すため）。
 */
export class EnrollmentError extends Error {
  constructor(
    readonly code: EnrollmentErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "EnrollmentError";
  }
}
