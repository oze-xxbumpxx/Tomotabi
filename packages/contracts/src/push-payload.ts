/**
 * 通知の中身（payload）の型。APIが組み立て、webのService Workerが確かめる。
 * 項目はF-43のとおり（版・操作のID・種類・旅行のID・対象の種類・対象のID・日時・
 * 相手の名前・旅行の名前だけ。URLやHTMLは入れない）。
 */

/** 中身の形の版。形を変えるとき上げる。 */
export const PUSH_PAYLOAD_SCHEMA_VERSION = 1;

/** 中身に入れる名前の上限（コードポイント）。越えたら末尾を「…」にする。 */
export const PUSH_ACTOR_NAME_MAX_LENGTH = 20;
export const PUSH_TRIP_NAME_MAX_LENGTH = 30;

/** 中身全体の上限（UTF-8のJSONのバイト数）。 */
export const PUSH_PAYLOAD_MAX_BYTES = 2048;

/** 対象の種類。 */
export const PUSH_TARGET_KINDS = [
  "plan",
  "achievement",
  "booking",
  "payment",
  "settlement",
] as const;
export type PushTargetKind = (typeof PUSH_TARGET_KINDS)[number];

/** 操作の種類（11種類）。 */
export const PUSH_ACTIONS = [
  "plan_added",
  "plan_cancelled",
  "plan_moved",
  "achievement_added",
  "achievement_cancelled",
  "booking_added",
  "booking_cancelled",
  "payment_added",
  "payment_cancelled",
  "settlement_completed",
  "settlement_cancelled",
] as const;
export type PushAction = (typeof PUSH_ACTIONS)[number];

/** actionとtargetKindの組み合わせ（設計書「どのUseCaseが、いつイベントを渡すか」）。 */
export const PUSH_ACTION_TARGET_KIND = {
  plan_added: "plan",
  plan_cancelled: "plan",
  plan_moved: "plan",
  achievement_added: "achievement",
  achievement_cancelled: "achievement",
  booking_added: "booking",
  booking_cancelled: "booking",
  payment_added: "payment",
  payment_cancelled: "payment",
  settlement_completed: "settlement",
  settlement_cancelled: "settlement",
} as const satisfies Record<PushAction, PushTargetKind>;

/**
 * 端末へ届く通知の中身。
 * eventId・tripId・targetIdはUUID、occurredAtはISO 8601の日時。
 * actorName・tripNameはAPI側で上限まで切り詰めた文字列。
 */
export type PushPayload = Readonly<{
  schemaVersion: typeof PUSH_PAYLOAD_SCHEMA_VERSION;
  eventId: string;
  action: PushAction;
  tripId: string;
  targetKind: PushTargetKind;
  targetId: string;
  occurredAt: string;
  actorName: string;
  tripName: string;
}>;

/** 保存のあとの処理へUseCaseが渡すイベント。payloadではなく名前は持たない。 */
export type NotificationEvent = Readonly<{
  eventId: string;
  action: PushAction;
  tripId: string;
  targetKind: PushTargetKind;
  targetId: string;
  actorUserId: string;
  occurredAt: string;
}>;
