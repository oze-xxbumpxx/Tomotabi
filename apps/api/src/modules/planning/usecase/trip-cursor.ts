import { ApiError } from "../../../common/http/api-error";
import type { TripListCursor } from "../adapter/outbound/planning-read.port";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 一覧のページ位置を不透明な文字列にする（base64url の JSON { c, i }）。
 * 中身を読む必要は利用者に無いが、秘密ではないため署名はしない。
 */
export function encodeTripCursor(cursor: TripListCursor): string {
  return Buffer.from(
    JSON.stringify({ c: cursor.createdAt.toISOString(), i: cursor.id }),
    "utf8",
  ).toString("base64url");
}

/**
 * @throws デコード不能・形が違う・値が不正なカーソルは 400 INVALID_REQUEST。
 */
export function decodeTripCursor(value: string): TripListCursor {
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw invalidCursor();
  }
  if (!isCursorShape(decoded)) {
    throw invalidCursor();
  }
  const createdAt = new Date(decoded.c);
  if (Number.isNaN(createdAt.getTime())) {
    throw invalidCursor();
  }
  return { createdAt, id: decoded.i };
}

function isCursorShape(value: unknown): value is { c: string; i: string } {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const { c, i } = value as { c?: unknown; i?: unknown };
  return typeof c === "string" && typeof i === "string" && UUID_PATTERN.test(i);
}

function invalidCursor(): ApiError {
  return new ApiError({
    code: "INVALID_REQUEST",
    status: 400,
    message: "cursor is invalid",
  });
}
