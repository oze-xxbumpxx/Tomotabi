import type { TimelineItemKind } from "@tomotabi/contracts";
import type { UnitOfWork } from "../../src/adapter/transaction/unit-of-work";
import type { ParticipantSlot } from "../../src/common/domain/participant-slot";
import type { UserId } from "../../src/common/domain/user-id";
import type {
  TripRosterEntry,
  TripRosterPort,
} from "../../src/modules/record/adapter/outbound/finance-work-context";
import type {
  PlanEventCancellation,
  RecordsReadContext,
  RecordsReadPort,
  RecordsTimelinePage,
  RecordsTimelineQuery,
  RecordTimelineAnchor,
  RecordTimelineRow,
} from "../../src/modules/record/adapter/outbound/records-read.port";
import type {
  Payment,
  PaymentCancellation,
} from "../../src/modules/record/domain/payment";
import { ACTOR, PARTNER } from "./planning-context";

export const TRIP_ID = "99999999-9999-4999-8999-999999999999";
export const PLAN_ID = "88888888-8888-4888-8888-888888888888";

function cancelKindOf(kind: TimelineItemKind): TimelineItemKind {
  return `${kind}_cancellation` as TimelineItemKind;
}

/**
 * 記録の一覧のUseCase試験用のインメモリ文脈。財務の文脈
 * （finance-context.ts）と同じく、呼び出し順をcallsに記録する。
 * 並び・絞り込み・ページの境目は本物のSQLと同じ決まりを再現する。
 */
export class InMemoryRecordsReadContext implements RecordsReadContext {
  readonly calls: string[] = [];
  private readonly rosterRows = new Map<string, TripRosterEntry[]>();
  readonly timelineRows: RecordTimelineRow[] = [];
  readonly paymentRows = new Map<string, Payment>();
  readonly paymentCancellationRows = new Map<string, PaymentCancellation>();
  readonly eventCancellationRows = new Map<string, PlanEventCancellation>();

  readonly roster: TripRosterPort = {
    find: (tripId, actorId) => {
      this.calls.push("roster.find");
      const entries = this.rosterRows.get(tripId) ?? [];
      return Promise.resolve(
        entries.some((entry) => entry.userId === actorId) ? entries : null,
      );
    },
  };

  readonly records: RecordsReadPort = {
    findAnchor: (tripId, kind, id) => {
      this.calls.push("records.findAnchor");
      const row = this.timelineRows.find(
        (candidate) =>
          candidate.tripId === tripId &&
          candidate.kind === kind &&
          candidate.id === id,
      );
      const anchor: RecordTimelineAnchor | null =
        row === undefined
          ? null
          : { createdAt: row.createdAt.toISOString(), kind: row.kind, id: row.id };
      return Promise.resolve(anchor);
    },

    listTimeline: (tripId, query) => {
      this.calls.push("records.listTimeline");
      return Promise.resolve(this.queryTimeline(tripId, query));
    },

    listPaymentsByIds: (tripId, paymentIds) => {
      this.calls.push("records.listPaymentsByIds");
      return Promise.resolve(
        [...this.paymentRows.values()].filter(
          (payment) =>
            payment.tripId === tripId && paymentIds.includes(payment.id),
        ),
      );
    },

    listPaymentCancellationsByIds: (tripId, paymentIds) => {
      this.calls.push("records.listPaymentCancellationsByIds");
      return Promise.resolve(
        [...this.paymentCancellationRows.values()].filter(
          (cancellation) =>
            cancellation.tripId === tripId &&
            paymentIds.includes(cancellation.paymentId),
        ),
      );
    },

    listPlanEventCancellationsByIds: (tripId, eventIds) => {
      this.calls.push("records.listPlanEventCancellationsByIds");
      return Promise.resolve(
        [...this.eventCancellationRows.values()].filter(
          (cancellation) =>
            cancellation.tripId === tripId &&
            eventIds.includes(cancellation.eventId),
        ),
      );
    },
  };

  private queryTimeline(
    tripId: string,
    query: RecordsTimelineQuery,
  ): RecordsTimelinePage {
    let rows = this.timelineRows.filter((row) => row.tripId === tripId);
    if (query.type !== null) {
      const kinds: readonly TimelineItemKind[] = [
        query.type,
        cancelKindOf(query.type),
      ];
      rows = rows.filter((row) => kinds.includes(row.kind));
    }
    if (query.planId !== null) {
      rows = rows.filter((row) => row.planId === query.planId);
    }
    if (query.recordId !== null) {
      rows = rows.filter((row) => row.id === query.recordId);
    }
    if (query.after !== null) {
      const after = query.after;
      const afterTime = Date.parse(after.createdAt);
      rows = rows.filter(
        (row) =>
          row.createdAt.getTime() < afterTime ||
          (row.createdAt.getTime() === afterTime &&
            (row.kind < after.kind ||
              (row.kind === after.kind && row.id < after.id))),
      );
    }
    rows = [...rows].sort((a, b) => {
      if (a.createdAt.getTime() !== b.createdAt.getTime()) {
        return b.createdAt.getTime() - a.createdAt.getTime();
      }
      if (a.kind !== b.kind) {
        return a.kind < b.kind ? 1 : -1;
      }
      return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
    });
    const items = rows.slice(0, query.limit);
    const last = items.at(-1);
    return {
      items,
      nextAnchor:
        rows.length > query.limit && last !== undefined
          ? { kind: last.kind, id: last.id }
          : null,
    };
  }

  /** 二人の参加者がいる旅行を登録する（既定はACTOR slot0・PARTNER slot1）。 */
  seedTrip(tripId = TRIP_ID, members?: { slot0: UserId; slot1: UserId }): void {
    const slot0 = members?.slot0 ?? ACTOR;
    const slot1 = members?.slot1 ?? PARTNER;
    this.rosterRows.set(tripId, [
      { slot: 0 as ParticipantSlot, userId: slot0, displayName: "ひなた" },
      { slot: 1 as ParticipantSlot, userId: slot1, displayName: "あおい" },
    ]);
  }

  /** 一覧の1行目のクエリの行を足す（元の記録・取り消しの両方に使う）。 */
  seedTimelineRow(row: RecordTimelineRow): void {
    this.timelineRows.push(row);
  }

  seedPayment(payment: Payment): void {
    this.paymentRows.set(payment.id, payment);
  }

  seedPaymentCancellation(cancellation: PaymentCancellation): void {
    this.paymentCancellationRows.set(cancellation.paymentId, cancellation);
  }

  seedPlanEventCancellation(cancellation: PlanEventCancellation): void {
    this.eventCancellationRows.set(cancellation.eventId, cancellation);
  }
}

export function inMemoryRecordsReadUnitOfWork(
  ctx: InMemoryRecordsReadContext,
): UnitOfWork<RecordsReadContext> {
  return { run: (work) => work(ctx) };
}
