import { randomUUID } from "node:crypto";
import { ApiError } from "../../../common/http/api-error";
import type { Clock } from "../../../adapter/clock/clock";
import type { UnitOfWork } from "../../../adapter/transaction/unit-of-work";
import { Plan } from "../domain/plan";
import { TripPeriod } from "../domain/trip-period";
import {
  MOVE_PLAN_OPERATION,
  type MovePlanInput,
  type MovePlanInputPort,
} from "../adapter/inbound/move-plan.input-port";
import type { PlanWriteResult } from "../adapter/inbound/plan-write.result";
import {
  noopNotificationPublisher,
  type NotificationPublisher,
} from "../adapter/outbound/notification-publisher";
import type { PlanningWorkContext } from "../adapter/outbound/planning-work-context";
import type { WriteLog } from "../adapter/outbound/write-log.port";
import { parsePlanDate } from "./plan-input";
import { executePlanWrite, runPlanUpdate } from "./plan-write-flow";

/**
 * 予定の日の移動。移動先が期間内かは、FOR SHAREで読んだ確定済みの期間で
 * 確かめる（期間の変更はFOR UPDATEを取るので、こちらがロックを持つ間は
 * 期間は変わらない。E-18）。
 */
export class MovePlanUseCase implements MovePlanInputPort {
  constructor(
    private readonly unitOfWork: UnitOfWork<PlanningWorkContext>,
    private readonly clock: Clock,
    private readonly writeLog: WriteLog,
    private readonly publisher: NotificationPublisher =
      noopNotificationPublisher,
  ) {}

  execute(input: MovePlanInput): Promise<PlanWriteResult> {
    return executePlanWrite(
      this.writeLog,
      MOVE_PLAN_OPERATION,
      input.tripId,
      input.planId,
      async () => {
        const outcome = await this.run(input);
        if (!outcome.replayed && outcome.changed) {
          // 再送でなく、日付が変わったときだけ渡す。
          this.publisher.publish({
            eventId: randomUUID(),
            action: "plan_moved",
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

  private async run(
    input: MovePlanInput,
  ): ReturnType<typeof runPlanUpdate> {
    const date = parsePlanDate(input.date);
    return this.unitOfWork.run((ctx) =>
      runPlanUpdate(
        ctx,
        {
          userId: input.userId,
          tripId: input.tripId,
          planId: input.planId,
          operation: MOVE_PLAN_OPERATION,
          key: input.key,
          ifMatch: input.ifMatch,
          requestHash: input.requestHash,
        },
        async (plan, trip) => {
          if (!TripPeriod.contains(trip.period, date)) {
            throw new ApiError({
              code: "PLAN_OUTSIDE_TRIP_PERIOD",
              status: 422,
              message: "Destination date is outside the trip period",
            });
          }
          return Plan.move(plan, date, this.clock.now());
        },
      ),
    );
  }
}
