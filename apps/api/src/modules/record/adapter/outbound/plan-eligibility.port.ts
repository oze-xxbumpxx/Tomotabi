import type { PlanKind } from "../../../planning/domain/plan-kind";

/**
 * 記録を付けられるかの判断に必要な予定の状態（planningの読み取り結果）。
 * 旅行の所属は照会自体が（tripId, planId）の一致で答える。
 */
export type PlanEligibility = Readonly<{
  id: string;
  tripId: string;
  kind: PlanKind;
  cancelledAt: Date | null;
}>;

/**
 * 予定の行を同じトランザクションでFOR NO KEY UPDATEで取り、種類・
 * 取りやめ・旅行の所属を返す口（record側のadapter）。compositionで
 * planningの予定の読み取りにつなぐ。旅行の中に無い予定はnull。
 *
 * 予定の書き込み（種類変更・取りやめ）と同じロックを取るので、
 * 記録の付ける・取り消すは予定の書き込みと予定行で一列に並ぶ。
 */
export interface PlanEligibilityPort {
  lockForUpdate(
    tripId: string,
    planId: string,
  ): Promise<PlanEligibility | null>;
}

/** UoWのトランザクションのdbハンドルから実装を作る（組み立て用）。 */
export type PlanEligibilityFactory = (db: unknown) => PlanEligibilityPort;

export const PLAN_ELIGIBILITY_FACTORY = Symbol("PLAN_ELIGIBILITY_FACTORY");
