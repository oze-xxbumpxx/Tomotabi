import type { UserId } from "../../../../common/domain/user-id";
import type { IdempotencyKey } from "../../../../common/http/idempotency-key";
import type { PlanWriteResult } from "./plan-write.result";

export const UPDATE_PLAN_INPUT_PORT = Symbol("UPDATE_PLAN_INPUT_PORT");
export const UPDATE_PLAN_OPERATION = "updatePlan";

/**
 * 部分更新の入力。undefined は「送られていない欄」（触れない）。
 * time / memo の null は「未定・なしに戻す」。
 */
export type UpdatePlanInput = Readonly<{
  userId: UserId;
  tripId: string;
  planId: string;
  key: IdempotencyKey;
  ifMatch: string;
  requestHash: string;
  name: string | undefined;
  kind: string | undefined;
  time: string | null | undefined;
  memo: string | null | undefined;
}>;

export interface UpdatePlanInputPort {
  /**
   * @throws 旅行が無い・参加していないとき 403 TRIP_NOT_ACCESSIBLE、
   *   予定が無いとき 404 PLAN_NOT_FOUND、履歴がある種類変更は
   *   409 PLAN_HAS_RECORD_HISTORY。
   */
  execute(input: UpdatePlanInput): Promise<PlanWriteResult>;
}
