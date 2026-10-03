import { ApiError } from "../../../common/http/api-error";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 確認の一覧のページ位置を不透明な文字列にする（base64urlのJSON { i }）。
 * 中身は起点の確認idだけ。created_atを入れないのは、JSのDateやISO
 * 文字列にするとミリ秒に丸まり、同じミリ秒内の違う行がページの境目で
 * 抜け落ちるため。比較にはDBの値をそのまま使う（findPreviewAnchor）。
 * 秘密ではないため署名はしない（trip-cursorと同じ仕組み）。
 */
export function encodePreviewCursor(previewId: string): string {
  return Buffer.from(JSON.stringify({ i: previewId }), "utf8").toString(
    "base64url",
  );
}

/**
 * @throwsデコード不能・形が違う・値が不正なカーソルは400 INVALID_REQUEST。
 */
export function decodePreviewCursor(value: string): string {
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw invalidPreviewCursor();
  }
  if (!isCursorShape(decoded)) {
    throw invalidPreviewCursor();
  }
  return decoded.i;
}

export function invalidPreviewCursor(): ApiError {
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
