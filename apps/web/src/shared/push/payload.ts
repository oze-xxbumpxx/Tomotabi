import {
  PUSH_ACTIONS_BY_TARGET_KIND,
  PUSH_ACTOR_NAME_MAX_LENGTH,
  PUSH_PAYLOAD_SCHEMA_VERSION,
  PUSH_TRIP_NAME_MAX_LENGTH,
} from "@tomotabi/contracts";
import type { PushPayload } from "@tomotabi/contracts";
import { codePointLength } from "@/shared/lib/text-length";
import { isUuidString } from "@/shared/lib/uuid";

const EXPECTED_KEYS = [
  "schemaVersion",
  "eventId",
  "action",
  "tripId",
  "targetKind",
  "targetId",
  "occurredAt",
  "actorName",
  "tripName",
] as const;

/**
 * ISO 8601の日時。APIが送るのは「2026-10-08T13:25:00.000Z」の形だが、
 * 日付だけ（時刻が無い）の値は日時とみなさない。
 */
const ISO_DATE_TIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;

function isIsoDateTime(value: string): boolean {
  return ISO_DATE_TIME_PATTERN.test(value) && !Number.isNaN(Date.parse(value));
}

function isNameLengthValid(value: unknown, maxLength: number): boolean {
  if (typeof value !== "string") return false;
  const length = codePointLength(value);
  return length >= 1 && length <= maxLength;
}

/**
 * 届いた中身が`PushPayload`の決まりに合うか確かめる（PU-11）。
 * 項目の過不足・11種類のactionとtargetKindの組み合わせ・UUID・日時・
 * 名前の長さを見て、1つでも違えばnullを返す。呼び出し側はnullのとき
 * 中身を使わず汎用の表示にする。
 */
export function parsePushPayload(data: unknown): PushPayload | null {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return null;
  }
  const keys = Object.keys(data);
  if (
    keys.length !== EXPECTED_KEYS.length ||
    !keys.every((key) => (EXPECTED_KEYS as readonly string[]).includes(key))
  ) {
    return null;
  }

  const candidate = data as Record<(typeof EXPECTED_KEYS)[number], unknown>;

  if (candidate.schemaVersion !== PUSH_PAYLOAD_SCHEMA_VERSION) return null;
  if (
    typeof candidate.targetKind !== "string" ||
    !Object.hasOwn(PUSH_ACTIONS_BY_TARGET_KIND, candidate.targetKind)
  ) {
    return null;
  }
  const targetKind = candidate.targetKind as keyof typeof PUSH_ACTIONS_BY_TARGET_KIND;
  const actions: readonly string[] = PUSH_ACTIONS_BY_TARGET_KIND[targetKind];
  if (typeof candidate.action !== "string" || !actions.includes(candidate.action)) {
    return null;
  }
  if (
    typeof candidate.eventId !== "string" ||
    !isUuidString(candidate.eventId) ||
    typeof candidate.tripId !== "string" ||
    !isUuidString(candidate.tripId) ||
    typeof candidate.targetId !== "string" ||
    !isUuidString(candidate.targetId)
  ) {
    return null;
  }
  if (
    typeof candidate.occurredAt !== "string" ||
    !isIsoDateTime(candidate.occurredAt)
  ) {
    return null;
  }
  if (
    !isNameLengthValid(candidate.actorName, PUSH_ACTOR_NAME_MAX_LENGTH) ||
    !isNameLengthValid(candidate.tripName, PUSH_TRIP_NAME_MAX_LENGTH)
  ) {
    return null;
  }

  return {
    schemaVersion: PUSH_PAYLOAD_SCHEMA_VERSION,
    eventId: candidate.eventId,
    action: candidate.action,
    tripId: candidate.tripId,
    targetKind,
    targetId: candidate.targetId,
    occurredAt: candidate.occurredAt,
    actorName: candidate.actorName,
    tripName: candidate.tripName,
  } as PushPayload;
}
