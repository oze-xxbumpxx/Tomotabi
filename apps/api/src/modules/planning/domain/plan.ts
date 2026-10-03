import type { BoundedText } from "../../../common/domain/bounded-text";
import type { LocalDate } from "../../../common/domain/local-date";
import type { LocalTime } from "../../../common/domain/local-time";
import type { UserId } from "../../../common/domain/user-id";
import type { PlanKind } from "./plan-kind";

export type Plan = Readonly<{
  id: string;
  tripId: string;
  name: BoundedText;
  kind: PlanKind;
  date: LocalDate;
  time: LocalTime | null;
  memo: BoundedText | null;
  cancelledAt: Date | null;
  cancelledBy: UserId | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}>;

/**
 * 部分更新の入力。キーがある欄だけが対象で、値が同じならversionは増えない。
 * 取りやめ欄（cancelledAt / cancelledBy）は含めない。取りやめは一度だけで
 * 復活のAPIは持たないため、編集で解除されることはない（詳細設計04 §2）。
 */
export type PlanPatch = Readonly<{
  name?: BoundedText;
  kind?: PlanKind;
  time?: LocalTime | null;
  memo?: BoundedText | null;
}>;

/** 種類を変えようとした予定に達成・予約の履歴（取り消し済みを含む）があった。 */
export class PlanHasRecordHistoryError extends Error {
  readonly planId: string;
  constructor(planId: string) {
    super("Plan has record history");
    this.name = "PlanHasRecordHistoryError";
    this.planId = planId;
  }
}

/** 取りやめ済みの予定をもう一度取りやめようとした。 */
export class PlanCancelledError extends Error {
  readonly planId: string;
  constructor(planId: string) {
    super("Plan is already cancelled");
    this.name = "PlanCancelledError";
    this.planId = planId;
  }
}

export const Plan = {
  /**
   * 部分更新する。差分が無ければ同じPlanを返す（versionは増やさない）。
   * 種類が変わるときだけhasRecordHistoryを見て拒否する。
   * @param patchキーがある欄だけが更新対象。undefinedは「送られていない」。
   * @param hasRecordHistory予定行のロックを持ったまま照会した履歴の有無（E-19）。
   * @throws PlanHasRecordHistoryError
   */
  update(
    plan: Plan,
    patch: PlanPatch,
    hasRecordHistory: boolean,
    at: Date,
  ): Plan {
    const changes: {
      -readonly [K in "name" | "kind" | "time" | "memo"]?: Plan[K];
    } = {};
    if (patch.name !== undefined && patch.name !== plan.name) {
      changes.name = patch.name;
    }
    if (
      patch.kind !== undefined &&
      patch.kind !== plan.kind
    ) {
      if (hasRecordHistory) {
        throw new PlanHasRecordHistoryError(plan.id);
      }
      changes.kind = patch.kind;
    }
    if (patch.time !== undefined && patch.time !== plan.time) {
      changes.time = patch.time;
    }
    if (patch.memo !== undefined && patch.memo !== plan.memo) {
      changes.memo = patch.memo;
    }
    if (Object.keys(changes).length === 0) {
      return plan;
    }
    return {
      ...plan,
      ...changes,
      version: plan.version + 1,
      updatedAt: at,
    };
  },

  /** 日を移動する。同じ日なら何もしない。期間内かは呼び出し側が旅行期間で確かめる。 */
  move(plan: Plan, date: LocalDate, at: Date): Plan {
    if (plan.date === date) {
      return plan;
    }
    return {
      ...plan,
      date,
      version: plan.version + 1,
      updatedAt: at,
    };
  },

  /**
   * 取りやめる（一度だけ）。取りやめ済みに再度取りやめると失敗する。
   * @throws PlanCancelledError
   */
  cancel(plan: Plan, at: Date, by: UserId): Plan {
    if (plan.cancelledAt !== null) {
      throw new PlanCancelledError(plan.id);
    }
    return {
      ...plan,
      cancelledAt: at,
      cancelledBy: by,
      version: plan.version + 1,
      updatedAt: at,
    };
  },
};
