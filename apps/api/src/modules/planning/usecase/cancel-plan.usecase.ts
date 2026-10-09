import { randomUUID } from "node:crypto";
import type { Clock } from "../../../adapter/clock/clock";
import type { UnitOfWork } from "../../../adapter/transaction/unit-of-work";
import { Plan } from "../domain/plan";
import {
  CANCEL_PLAN_OPERATION,
  type CancelPlanInput,
  type CancelPlanInputPort,
} from "../adapter/inbound/cancel-plan.input-port";
import type { PlanWriteResult } from "../adapter/inbound/plan-write.result";
import {
  noopNotificationPublisher,
  type NotificationPublisher,
} from "../adapter/outbound/notification-publisher";
import type { PlanningWorkContext } from "../adapter/outbound/planning-work-context";
import type { WriteLog } from "../adapter/outbound/write-log.port";
import { executePlanWrite, runPlanUpdate } from "./plan-write-flow";

/**
 * 予定の取りやめ（一度だけ）。復活のAPIは持たない。
 * 部分更新には取りやめ欄が無いため、取りやめ後の編集で解除されることはない。
 */
export class CancelPlanUseCase implements CancelPlanInputPort {
  constructor(
    private readonly unitOfWork: UnitOfWork<PlanningWorkContext>,
    private readonly clock: Clock,
    private readonly writeLog: WriteLog,
    private readonly publisher: NotificationPublisher =
      noopNotificationPublisher,
  ) {}

  execute(input: CancelPlanInput): Promise<PlanWriteResult> {
    return executePlanWrite(
      this.writeLog,
      CANCEL_PLAN_OPERATION,
      input.tripId,
      input.planId,
      async () => {
        const outcome = await this.run(input);
        if (!outcome.replayed && outcome.changed) {
          // 再送でなく、取りやめに変わったときだけ渡す。
          this.publisher.publish({
            eventId: randomUUID(),
            action: "plan_cancelled",
            targetKind: "plan",
            tripId: input.tripId,
            targetId: input.planId,
            actorUserId: input.userId,
            occurredAt: this.clock.now().toISOString(),
          });
        }
        return outcome;
      },
    );
  }

  private run(input: CancelPlanInput): ReturnType<typeof runPlanUpdate> {
    return this.unitOfWork.run((ctx) =>
      runPlanUpdate(
        ctx,
        {
          userId: input.userId,
          tripId: input.tripId,
          planId: input.planId,
          operation: CANCEL_PLAN_OPERATION,
          key: input.key,
          ifMatch: input.ifMatch,
          requestHash: input.requestHash,
        },
        async (plan) => Plan.cancel(plan, this.clock.now(), input.userId),
      ),
    );
  }
}
