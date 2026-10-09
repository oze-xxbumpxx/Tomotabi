import { randomUUID } from "node:crypto";
import type { Cancellation } from "@tomotabi/contracts";
import { ApiError } from "../../../common/http/api-error";
import type { WriteLog } from "../../planning/adapter/outbound/write-log.port";
import type {
  CancelPlanEventInput,
  CancelPlanEventInputPort,
} from "../adapter/inbound/cancel-plan-event.input-port";
import { cancelPlanEventOperation } from "../adapter/inbound/cancel-plan-event.input-port";
import type { PlanEventCancellationResult } from "../adapter/inbound/plan-event-write.result";
import type { PlanEventUnitOfWork } from "../adapter/outbound/plan-event-work-context";
import {
  noopNotificationPublisher,
  type NotificationPublisher,
} from "../adapter/outbound/notification-publisher";
import { toPlanEventCancellationDto } from "./plan-event-dto";
import {
  executePlanEventWrite,
  runPlanEventWriteTransaction,
  type PlanEventWriteOutcome,
} from "./plan-event-write-flow";

/**
 * 参加している旅行の中で、記録が無い・別の旅行の記録・URLの種類と
 * 記録の種類が違う場合はどれも同じ404（どれも同じ応答で、存在を漏らさない）。
 */
export function recordNotFound(): ApiError {
  return new ApiError({
    code: "RECORD_NOT_FOUND",
    status: 404,
    message: "Record was not found in the trip",
  });
}

/**
 * 達成・予約の取り消し（達成と予約で共有。URLの種類はinputのeventKind）。
 * 取り消しは別の記録を足す形で、元の記録の行は残る。占有行は対象の
 * 記録のidで消す（planIdと種類で消すと、付け直した新しい記録まで消す）。
 * 同じ取り消しの再送・別キーの再取り消しは今ある取り消しを返す。
 */
export class CancelPlanEventUseCase implements CancelPlanEventInputPort {
  constructor(
    private readonly unitOfWork: PlanEventUnitOfWork,
    private readonly writeLog: WriteLog,
    private readonly publisher: NotificationPublisher =
      noopNotificationPublisher,
  ) {}

  execute(input: CancelPlanEventInput): Promise<PlanEventCancellationResult> {
    return executePlanEventWrite(
      this.writeLog,
      cancelPlanEventOperation(input.eventKind),
      input.tripId,
      input.recordId,
      async () => {
        const outcome = await this.run(input);
        if (!outcome.replayed && outcome.httpStatus === 201) {
          // 再送でなく新しい取り消しが書けたときだけ渡す
          // （既にあった取り消しの200は渡さない）。targetIdは元の記録。
          const base = {
            eventId: randomUUID(),
            tripId: input.tripId,
            targetId: outcome.resourceId,
            actorUserId: input.userId,
            occurredAt: new Date().toISOString(),
          };
          this.publisher.publish(
            input.eventKind === "achievement"
              ? {
                  ...base,
                  targetKind: "achievement",
                  action: "achievement_cancelled",
                }
              : { ...base, targetKind: "booking", action: "booking_cancelled" },
          );
        }
        return outcome;
      },
    );
  }

  private run(
    input: CancelPlanEventInput,
  ): Promise<PlanEventWriteOutcome<Cancellation>> {
    return runPlanEventWriteTransaction<Cancellation>(
      this.unitOfWork,
      {
        userId: input.userId,
        tripId: input.tripId,
        operation: cancelPlanEventOperation(input.eventKind),
        key: input.key,
        requestHash: input.requestHash,
      },
      async (work) => {
        const event = await work.planEvents.findInTrip(
          input.tripId,
          input.recordId,
        );
        if (event === null || event.kind !== input.eventKind) {
          throw recordNotFound();
        }
        // 記録の予定の行をFOR NO KEY UPDATEで取る。複合FKがあるため
        // 予定は必ず旅行の中にある（nullはデータの不整合）。
        const eligibility = await work.planEligibility.lockForUpdate(
          input.tripId,
          event.planId,
        );
        if (eligibility === null) {
          throw new Error("plan row is missing for an existing plan event");
        }
        const existing = await work.planEvents.findCancellationInTrip(
          input.tripId,
          event.id,
        );
        if (existing !== null) {
          return {
            body: toPlanEventCancellationDto(existing),
            httpStatus: 200,
            resourceType: "plan_event_cancellation",
            resourceId: event.id,
          };
        }
        const cancellation = await work.planEvents.insertCancellation({
          eventId: event.id,
          tripId: input.tripId,
          cancelledBy: input.userId,
        });
        await work.planEvents.deleteActive(event.id);
        return {
          body: toPlanEventCancellationDto(cancellation),
          httpStatus: 201,
          resourceType: "plan_event_cancellation",
          resourceId: event.id,
        };
      },
      async (work) => {
        // 別の接続の取り消しが先にコミットしたときは、今ある取り消しを返す。
        const existing = await work.planEvents.findCancellationInTrip(
          input.tripId,
          input.recordId,
        );
        if (existing === null) {
          return null;
        }
        return {
          httpStatus: 200,
          body: toPlanEventCancellationDto(existing),
          replayed: false,
          resourceId: input.recordId,
        };
      },
    );
  }
}
