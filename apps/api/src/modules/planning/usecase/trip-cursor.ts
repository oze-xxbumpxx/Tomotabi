import { ApiError } from "../../../common/http/api-error";
import type { TripListCursor } from "../adapter/outbound/planning-read.port";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 一覧のページ位置を不透明な文字列にする（base64urlのJSON { i }）。
 * 中身は起点の旅行idだけ。created_atを入れないのは、JSのDateやISO
 * 文字列にするとミリ秒に丸まり、同じミリ秒内の違う行がページの境目で
 * 抜け落ちるため。比較にはDBの値をそのまま使う（findTripAnchor）。
 * 秘密ではないため署名はしない。
 */
export function encodeTripCursor(cursor: TripListCursor): string {
  return Buffer.from(JSON.stringify({ i: cursor.id }), "utf8").toString(
    "base64url",
  );
}

/**
 * @throwsデコード不能・形が違う・値が不正なカーソルは400 INVALID_REQUEST。
 */
export function decodeTripCursor(value: string): TripListCursor {
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw invalidTripCursor();
  }
  if (!isCursorShape(decoded)) {
    throw invalidTripCursor();
  }
  return { id: decoded.i };
}

export function invalidTripCursor(): ApiError {
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
