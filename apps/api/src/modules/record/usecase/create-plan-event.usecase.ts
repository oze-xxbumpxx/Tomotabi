import type { PlanEvent as PlanEventContract } from "@tomotabi/contracts";
import { ApiError } from "../../../common/http/api-error";
import { planNotFound } from "../../planning/usecase/plan-write-flow";
import type { WriteLog } from "../../planning/adapter/outbound/write-log.port";
import { planEventRejection } from "../domain/plan-event";
import type {
  CreatePlanEventInput,
  CreatePlanEventInputPort,
} from "../adapter/inbound/create-plan-event.input-port";
import { createPlanEventOperation } from "../adapter/inbound/create-plan-event.input-port";
import type { PlanEventWriteResult } from "../adapter/inbound/plan-event-write.result";
import type { PlanEventUnitOfWork } from "../adapter/outbound/plan-event-work-context";
import { toPlanEventDto } from "./plan-event-dto";
import {
  executePlanEventWrite,
  runPlanEventWriteTransaction,
  type PlanEventWriteOutcome,
} from "./plan-event-write-flow";

function planKindNotSupported(): ApiError {
  return new ApiError({
    code: "PLAN_KIND_NOT_SUPPORTED",
    status: 409,
    message: "The plan kind does not support this record",
  });
}

function planCancelled(): ApiError {
  return new ApiError({
    code: "PLAN_CANCELLED",
    status: 409,
    message: "The plan is already cancelled",
  });
}

/** 有効な記録が既にある競合。今ある記録のidをdetailsで返す。 */
export function recordAlreadyActive(existingRecordId: string): ApiError {
  return new ApiError({
    code: "RECORD_ALREADY_ACTIVE",
    status: 409,
    message: "An active record already exists for the plan",
    details: { existingRecordId },
  });
}

/**
 * 達成・予約を付ける（達成と予約で共有。URLの種類はinputのeventKind）。
 * 予定行をFOR NO KEY UPDATEで取ってから決まりを確かめるため、
 * 種類の変更・予定の取りやめ・同じ予定への同時の付けとは一列に並ぶ。
 * 有効な記録があれば409 RECORD_ALREADY_ACTIVE（既存の記録idを返す）。
 */
export class CreatePlanEventUseCase implements CreatePlanEventInputPort {
  constructor(
    private readonly unitOfWork: PlanEventUnitOfWork,
    private readonly writeLog: WriteLog,
  ) {}

  execute(input: CreatePlanEventInput): Promise<PlanEventWriteResult> {
    return executePlanEventWrite(
      this.writeLog,
      createPlanEventOperation(input.eventKind),
      input.tripId,
      null,
      () => this.run(input),
    );
  }

  private run(
    input: CreatePlanEventInput,
  ): Promise<PlanEventWriteOutcome<PlanEventContract>> {
    return runPlanEventWriteTransaction<PlanEventContract>(
      this.unitOfWork,
      {
        userId: input.userId,
        tripId: input.tripId,
        operation: createPlanEventOperation(input.eventKind),
        key: input.key,
        requestHash: input.requestHash,
      },
      async (work) => {
        const eligibility = await work.planEligibility.lockForUpdate(
          input.tripId,
          input.planId,
        );
        if (eligibility === null) {
          throw planNotFound();
        }
        const rejection = planEventRejection(input.eventKind, eligibility);
        if (rejection === "kind_not_supported") {
          throw planKindNotSupported();
        }
        if (rejection === "plan_cancelled") {
          throw planCancelled();
        }
        const activeId = await work.planEvents.findActiveId(
          input.planId,
          input.eventKind,
        );
        if (activeId !== null) {
          throw recordAlreadyActive(activeId);
        }
        const event = await work.planEvents.insert({
          tripId: input.tripId,
          planId: input.planId,
          kind: input.eventKind,
          createdBy: input.userId,
        });
        await work.planEvents.insertActive(event);
        return {
          body: toPlanEventDto(event),
          httpStatus: 201,
          resourceType: "plan_event",
          resourceId: event.id,
        };
      },
      async (work) => {
        // 受領の照会で説明できない一意違反は占有行の主キー違反。
        // 勝った側が入れた記録のidを読んで409に写す。
        const activeId = await work.planEvents.findActiveId(
          input.planId,
          input.eventKind,
        );
        if (activeId === null) {
          return null;
        }
        throw recordAlreadyActive(activeId);
      },
    );
  }
}
