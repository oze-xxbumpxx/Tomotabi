import type { TimelineItemKind } from "@tomotabi/contracts";
import { ApiError } from "../../../common/http/api-error";
import type { RecordType } from "../adapter/outbound/records-read.port";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TIMELINE_KINDS: readonly TimelineItemKind[] = [
  "achievement",
  "booking",
  "payment",
  "achievement_cancellation",
  "booking_cancellation",
  "payment_cancellation",
];

const RECORD_TYPES: readonly RecordType[] = [
  "achievement",
  "booking",
  "payment",
];

/** カーソルに結びつける絞り込みの条件。無指定はnull。 */
export type RecordsCursorScope = Readonly<{
  tripId: string;
  type: RecordType | null;
  planId: string | null;
}>;

export type RecordsCursor = Readonly<{
  tripId: string;
  type: RecordType | null;
  planId: string | null;
  kind: TimelineItemKind;
  id: string;
}>;

/**
 * 一覧のページ位置を不透明な文字列にする（base64urlのJSON）。
 * 最後の行の種類・IDに、旅行のIDと絞り込みの条件を結びつける。
 * 種類が要るのは、取り消しの行のIDが元の記録と同じで、同じ日時の
 * 2行がページの境目に来たときIDだけでは見分けられないため。
 * created_atを入れないのはtrip-cursor.tsと同じ理由（ミリ秒に丸まる）。
 * 秘密ではないため署名はしない。
 */
export function encodeRecordsCursor(cursor: RecordsCursor): string {
  return Buffer.from(
    JSON.stringify({
      t: cursor.tripId,
      y: cursor.type,
      p: cursor.planId,
      k: cursor.kind,
      i: cursor.id,
    }),
    "utf8",
  ).toString("base64url");
}

/**
 * カーソルを読み戻し、この要求の旅行・絞り込みと照合する。
 * @throws デコード不能・形が違う・値が不正なカーソルと、別の旅行・
 * 別の絞り込みに紐付くカーソルは400 INVALID_REQUEST。
 */
export function decodeRecordsCursor(
  value: string,
  scope: RecordsCursorScope,
): { kind: TimelineItemKind; id: string } {
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw invalidRecordsCursor();
  }
  if (!isCursorShape(decoded)) {
    throw invalidRecordsCursor();
  }
  if (
    decoded.t !== scope.tripId ||
    decoded.y !== scope.type ||
    decoded.p !== scope.planId
  ) {
    throw invalidRecordsCursor();
  }
  return { kind: decoded.k, id: decoded.i };
}

export function invalidRecordsCursor(): ApiError {
  return new ApiError({
    code: "INVALID_REQUEST",
    status: 400,
    message: "cursor is invalid",
  });
}

type CursorJson = Readonly<{
  t: string;
  y: RecordType | null;
  p: string | null;
  k: TimelineItemKind;
  i: string;
}>;

function isCursorShape(value: unknown): value is CursorJson {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const { t, y, p, k, i } = value as {
    t?: unknown;
    y?: unknown;
    p?: unknown;
    k?: unknown;
    i?: unknown;
  };
  if (typeof t !== "string" || !UUID_PATTERN.test(t)) {
    return false;
  }
  if (
    y !== null &&
    !(typeof y === "string" && (RECORD_TYPES as readonly string[]).includes(y))
  ) {
    return false;
  }
  if (p !== null && !(typeof p === "string" && UUID_PATTERN.test(p))) {
    return false;
  }
  if (
    typeof k !== "string" ||
    !(TIMELINE_KINDS as readonly string[]).includes(k)
  ) {
    return false;
  }
  return typeof i === "string" && UUID_PATTERN.test(i);
}
