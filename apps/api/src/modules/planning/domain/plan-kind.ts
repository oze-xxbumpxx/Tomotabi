const PLAN_KINDS = [
  "place",
  "food",
  "shopping",
  "lodging",
  "transport",
] as const;

/**
 * 予定の種類（place / food / shopping / lodging / transport）。
 * 達成・予約の対象種類はM4が使う（詳細設計04 §3）。
 */
export type PlanKind = (typeof PLAN_KINDS)[number];

const ACHIEVEMENT_KINDS: ReadonlySet<PlanKind> = new Set([
  "place",
  "food",
  "shopping",
]);
const BOOKING_KINDS: ReadonlySet<PlanKind> = new Set([
  "food",
  "lodging",
  "transport",
]);

export const PlanKind = {
  /**
   * @throws 5種類以外のときErrorを投げる。
   */
  parse(value: string): PlanKind {
    if (!(PLAN_KINDS as readonly string[]).includes(value)) {
      throw new Error("PlanKind must be one of place/food/shopping/lodging/transport");
    }
    return value as PlanKind;
  },

  /** 達成を記録できる種類か（place / food / shopping）。M4で使う。 */
  supportsAchievement(kind: PlanKind): boolean {
    return ACHIEVEMENT_KINDS.has(kind);
  },

  /** 予約を記録できる種類か（food / lodging / transport）。M4で使う。 */
  supportsBooking(kind: PlanKind): boolean {
    return BOOKING_KINDS.has(kind);
  },
};
