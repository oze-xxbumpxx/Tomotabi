/**
 * 通知の中身（Web Pushのpayload）。「{相手の名前}が「{旅行の名前}」で{操作}」を
 * 画面で組み立てるのに必要な項目だけを持つ。URL・金額・場所・予定の名前・
 * メモは入れない（要件F-42・F-43、設計書「通知の中身」）。
 * Service Workerは受け取った中身の形をここと同じ決まりで確かめてから使う。
 */

/** 中身の版。形を変えるときに上げる（B-02）。 */
export const PUSH_PAYLOAD_SCHEMA_VERSION = 1;

/** 相手の名前の上限。超えた分はAPIが切り詰める。 */
export const PUSH_ACTOR_NAME_MAX_LENGTH = 20;

/** 旅行の名前の上限。超えた分はAPIが切り詰める。 */
export const PUSH_TRIP_NAME_MAX_LENGTH = 30;

/** 中身全体の上限（UTF-8のJSONのバイト数）。超えたらAPIが名前を切り詰める。 */
export const PUSH_PAYLOAD_MAX_BYTES = 2048;

/**
 * 対象の種類と、許可する操作の組み合わせ。設計資料「Web Push通知」の
 * actionとtargetKindの表の写し（計11種類）。この表に無い組み合わせは不正。
 */
export const PUSH_ACTIONS_BY_TARGET_KIND = {
  plan: ["plan_added", "plan_cancelled", "plan_moved"],
  achievement: ["achievement_added", "achievement_cancelled"],
  booking: ["booking_added", "booking_cancelled"],
  payment: ["payment_added", "payment_cancelled"],
  settlement: ["settlement_completed", "settlement_cancelled"],
} as const;

/** 対象の種類。旅行の予定・達成・予約・支払い・精算。 */
export type PushTargetKind = keyof typeof PUSH_ACTIONS_BY_TARGET_KIND;

/** 操作の種類（11種類）。 */
export type PushAction =
  (typeof PUSH_ACTIONS_BY_TARGET_KIND)[PushTargetKind][number];

/** 操作と対象の種類の組み合わせ。許可された11組だけを型で表す。 */
export type PushActionTarget = {
  [K in PushTargetKind]: {
    targetKind: K;
    action: (typeof PUSH_ACTIONS_BY_TARGET_KIND)[K][number];
  };
}[PushTargetKind];

/**
 * 通知の中身。actionとtargetKindは許可された組み合わせだけ
 * （例: settlement_cancelledにtargetKind=planは作れない）。
 */
export type PushPayload = PushActionTarget & {
  /** 中身の版。今はPUSH_PAYLOAD_SCHEMA_VERSION（1）だけ。 */
  schemaVersion: typeof PUSH_PAYLOAD_SCHEMA_VERSION;
  /** 操作のID（UUID）。同じ操作の重複は受け手が捨てる。 */
  eventId: string;
  /** 旅行のID（UUID）。 */
  tripId: string;
  /** 対象のID。種類ごとのID（予定・支払い・精算など）。 */
  targetId: string;
  /** 操作の日時（ISO 8601）。 */
  occurredAt: string;
  /** 操作した相手の名前（APIがPUSH_ACTOR_NAME_MAX_LENGTHに切り詰める）。 */
  actorName: string;
  /** 旅行の名前（APIがPUSH_TRIP_NAME_MAX_LENGTHに切り詰める）。 */
  tripName: string;
};
