import { ApiError } from "../../../common/http/api-error";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 精算の一覧のページ位置を不透明な文字列にする（base64url の JSON { i }）。
 * 中身は起点の精算 id だけ。連番を直接入れないのは preview-cursor と同じ
 * 仕組みに揃えるため。比較には DB の値をそのまま使う（findSettlementAnchor）。
 * 秘密ではないため署名はしない。
 */
export function encodeSettlementCursor(settlementId: string): string {
  return Buffer.from(JSON.stringify({ i: settlementId }), "utf8").toString(
    "base64url",
  );
}

/**
 * @throws デコード不能・形が違う・値が不正なカーソルは 400 INVALID_REQUEST。
 */
export function decodeSettlementCursor(value: string): string {
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw invalidSettlementCursor();
  }
  if (!isCursorShape(decoded)) {
    throw invalidSettlementCursor();
  }
  return decoded.i;
}

export function invalidSettlementCursor(): ApiError {
  return new ApiError({
    code: "INVALID_REQUEST",
    status: 400,
    message: "cursor is invalid",
  });
}

function isCursorShape(value: unknown): value is { i: string } {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const { i } = value as { i?: unknown };
  return typeof i === "string" && UUID_PATTERN.test(i);
}
