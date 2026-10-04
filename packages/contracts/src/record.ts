import type { Payment } from "./finance";
import type { Cancellation, EventKind, PlanEvent } from "./plan";

/**
 * 記録の一覧の行の種類。元の記録3つと、その取り消し3つ。
 * 取り消しの行は元の記録と同じIDになる（元の記録の種類 + `_cancellation`）。
 */
export type TimelineItemKind =
  | EventKind
  | "payment"
  | "achievement_cancellation"
  | "booking_cancellation"
  | "payment_cancellation";

/**
 * 記録の一覧の1行。`detail`は元の記録ならEvent・Payment、
 * 取り消しの行ならCancellation。取り消しの行は`id`と`targetId`が
 * 同じ値（元の記録のID）になる。
 */
export type TimelineItem = {
  id: string;
  kind: TimelineItemKind;
  /** ISO 8601の日時。 */
  createdAt: string;
  actorId: string;
  planId: string | null;
  targetId: string;
  detail: PlanEvent | Cancellation | Payment;
};

/** 記録の一覧の応答。`nextCursor`は続きが無いときnull。 */
export type Records = {
  items: TimelineItem[];
  nextCursor: string | null;
};
