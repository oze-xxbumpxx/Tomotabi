import type { Clock } from "../../../adapter/clock/clock";
import type { UnitOfWork } from "../../../adapter/transaction/unit-of-work";
import { Plan } from "../domain/plan";
import type { PlanKind } from "../domain/plan-kind";
import {
  UPDATE_PLAN_OPERATION,
  type UpdatePlanInput,
  type UpdatePlanInputPort,
} from "../adapter/inbound/update-plan.input-port";
import type { PlanWriteResult } from "../adapter/inbound/plan-write.result";
import type { PlanningWorkContext } from "../adapter/outbound/planning-work-context";
import type { WriteLog } from "../adapter/outbound/write-log.port";
import {
  parsePlanKind,
  parsePlanMemo,
  parsePlanName,
  parsePlanTime,
} from "./plan-input";
import { executePlanWrite, runPlanUpdate } from "./plan-write-flow";

/**
 * 予定の部分更新。日付は含めない（日の移動は move が担う）。
 * 種類変更は予定行のロックを持ったまま履歴を照会してから Domain に渡す
 * （照会と変更の間に達成・予約が割り込まないようにするため。E-19）。
 */
export class UpdatePlanUseCase implements UpdatePlanInputPort {
  constructor(
    private readonly unitOfWork: UnitOfWork<PlanningWorkContext>,
    private readonly clock: Clock,
    private readonly writeLog: WriteLog,
  ) {}

  execute(input: UpdatePlanInput): Promise<PlanWriteResult> {
    return executePlanWrite(
      this.writeLog,
      UPDATE_PLAN_OPERATION,
      input.tripId,
      input.planId,
      () => this.run(input),
    );
  }

  private async run(
    input: UpdatePlanInput,
  ): ReturnType<typeof runPlanUpdate> {
    // 書き込み用に Readonly を外した PlanPatch と同じ形。
    const patch: {
      -readonly [K in "name" | "kind" | "time" | "memo"]?: Plan[K];
    } = {};
    if (input.name !== undefined) {
      patch.name = parsePlanName(input.name);
    }
    let kind: PlanKind | undefined;
    if (input.kind !== undefined) {
      kind = parsePlanKind(input.kind);
      patch.kind = kind;
    }
    if (input.time !== undefined) {
      patch.time = input.time === null ? null : parsePlanTime(input.time);
    }
    if (input.memo !== undefined) {
      patch.memo = parsePlanMemo(input.memo);
    }
    return this.unitOfWork.run((ctx) =>
      runPlanUpdate(ctx, toCommand(input), async (plan, _trip, context) => {
        // 履歴の照会は種類が実際に変わるときだけでよい。予定行のロック中に
        // 呼ぶので、照会後・更新前の INSERT は起きない（E-19）。
        const hasRecordHistory =
          kind !== undefined && kind !== plan.kind
            ? await context.recordHistory.hasHistory(plan.id)
            : false;
        return Plan.update(plan, patch, hasRecordHistory, this.clock.now());
      }),
    );
  }
}

function toCommand(input: UpdatePlanInput) {
  return {
    userId: input.userId,
    tripId: input.tripId,
    planId: input.planId,
    operation: UPDATE_PLAN_OPERATION,
    key: input.key,
    ifMatch: input.ifMatch,
    requestHash: input.requestHash,
  };
}
