import type {
  Cancellation,
  EventKind,
  PlanEvent,
  TimelineItem,
} from "@tomotabi/contracts";
import type { Payment, PaymentCancellation } from "../domain/payment";
import type { TripRosterEntry } from "../adapter/outbound/finance-work-context";
import type {
  PlanEventCancellation,
  RecordTimelineRow,
} from "../adapter/outbound/records-read.port";
import { toPaymentDto } from "./payment-dto";

function toEventCancellationDto(
  cancellation: PlanEventCancellation,
): Cancellation {
  return {
    targetId: cancellation.eventId,
    cancelledBy: cancellation.cancelledBy,
    createdAt: cancellation.createdAt.toISOString(),
  };
}

function toEventDto(
  row: RecordTimelineRow,
  cancellation: PlanEventCancellation | null,
): PlanEvent {
  if (row.planId === null) {
    // plan_events.plan_idはNOT NULLなので、達成・予約の行でここには来ない
    // （来たらデータの不整合）。
    throw new Error("Plan event row is missing planId");
  }
  return {
    id: row.id,
    tripId: row.tripId,
    planId: row.planId,
    kind: row.kind as EventKind,
    createdBy: row.actorId,
    createdAt: row.createdAt.toISOString(),
    cancellation:
      cancellation === null ? null : toEventCancellationDto(cancellation),
  };
}

/**
 * 1行目のクエリの行と、種類ごとにまとめて読んだ中身から、
 * 契約のTimelineItemを組み立てる。
 */
export function joinTimelineItems(input: {
  rows: readonly RecordTimelineRow[];
  roster: readonly TripRosterEntry[];
  payments: readonly Payment[];
  paymentCancellations: readonly PaymentCancellation[];
  planEventCancellations: readonly PlanEventCancellation[];
}): readonly TimelineItem[] {
  const paymentsById = new Map(input.payments.map((p) => [p.id, p]));
  const paymentCancellationsById = new Map(
    input.paymentCancellations.map((c) => [c.paymentId, c]),
  );
  const eventCancellationsById = new Map(
    input.planEventCancellations.map((c) => [c.eventId, c]),
  );
  return input.rows.map((row) => {
    const base = {
      id: row.id,
      kind: row.kind,
      createdAt: row.createdAt.toISOString(),
      actorId: row.actorId,
      planId: row.planId,
      targetId: row.targetId,
    };
    switch (row.kind) {
      case "payment": {
        const payment = paymentsById.get(row.id);
        if (payment === undefined) {
          // 一覧の行はpaymentsの行から作るので、同じトランザクションで
          // 中身が無いのはデータの不整合。
          throw new Error(`Payment row is missing for ${row.id}`);
        }
        return {
          ...base,
          detail: toPaymentDto(
            payment,
            input.roster,
            paymentCancellationsById.get(row.id) ?? null,
          ),
        };
      }
      case "achievement":
      case "booking":
        return {
          ...base,
          detail: toEventDto(
            row,
            eventCancellationsById.get(row.id) ?? null,
          ),
        };
      default:
        return {
          ...base,
          detail: {
            targetId: row.targetId,
            cancelledBy: row.actorId,
            createdAt: row.createdAt.toISOString(),
          },
        };
    }
  });
}

