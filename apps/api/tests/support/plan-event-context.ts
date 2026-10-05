import type { UnitOfWork } from "../../src/adapter/transaction/unit-of-work";
import type { UserId } from "../../src/common/domain/user-id";
import type { CommandReceipt } from "../../src/common/idempotency/command-receipt";
import type { IdempotencyKey } from "../../src/common/http/idempotency-key";
import type { PlanKind } from "../../src/modules/planning/domain/plan-kind";
import type { CommandReceiptStore } from "../../src/modules/planning/adapter/outbound/planning-work-context";
import type { PlanEligibilityPort } from "../../src/modules/record/adapter/outbound/plan-eligibility.port";
import type { PlanEventRepository } from "../../src/modules/record/adapter/outbound/plan-event.repository";
import type {
  PlanEventWorkContext,
  TripShareLockPort,
} from "../../src/modules/record/adapter/outbound/plan-event-work-context";
import type {
  NewPlanEvent,
  NewPlanEventCancellation,
  PlanEvent,
  PlanEventCancellation,
  PlanEventKind,
} from "../../src/modules/record/domain/plan-event";
import { ACTOR, PARTNER } from "./planning-context";

const BASE_TIME = new Date("2026-09-01T00:00:00.000Z");

export const TRIP_ID = "99999999-9999-4999-8999-999999999999";
export const PLAN_ID = "88888888-8888-4888-8888-888888888888";

function receiptKey(
  actorId: UserId,
  operation: string,
  key: IdempotencyKey,
): string {
  return `${actorId}|${operation}|${key}`;
}

function activeKey(planId: string, kind: PlanEventKind): string {
  return `${planId}|${kind}`;
}

/**
 * 達成・予約の書き込みのUseCase試験用のインメモリ文脈。メソッドの
 * 呼び出し順をcallsに記録し、ロック順序（旅行FOR SHARE → receipt →
 * 予定FOR NO KEY UPDATE → 書き込み）が検査できるようにする。
 */
export class InMemoryPlanEventContext implements PlanEventWorkContext {
  readonly calls: string[] = [];
  private readonly members = new Map<string, Set<string>>();
  readonly receiptRows = new Map<string, CommandReceipt>();
  readonly planRows = new Map<
    string,
    { tripId: string; kind: PlanKind; cancelledAt: Date | null }
  >();
  readonly eventRows = new Map<string, PlanEvent>();
  readonly activeRows = new Map<string, string>();
  readonly cancellationRows = new Map<string, PlanEventCancellation>();
  private nextId = 0;
  /** receipts.insertで23505を投げさせる回数（一意違反の試験用）。 */
  failReceiptInsertTimes = 0;
  /**
   * 失敗させたときに勝った側がCOMMITしたと見なす受領。nullなら受領は
   * まだ無い（読み直しで元のエラーを投げ直す経路の確認用）。
   */
  winningReceiptOnFailure: CommandReceipt | null = null;
  /** insertActiveで23505を投げさせる回数（占有行の主キー違反の試験用）。 */
  failActiveInsertTimes = 0;
  /** 失敗させたときに勝った側が入れたと見なす占有行の記録id。 */
  winningActiveOnFailure: { planId: string; kind: PlanEventKind; eventId: string } | null =
    null;

  readonly trips: TripShareLockPort = {
    lockForShare: (tripId, actorId) => {
      this.calls.push("trips.lockForShare");
      const members = this.members.get(tripId);
      if (members === undefined || !members.has(actorId)) {
        return Promise.resolve(null);
      }
      return Promise.resolve({ id: tripId });
    },
  };

  readonly receipts: CommandReceiptStore = {
    find: (actorId, operation, key) => {
      this.calls.push("receipts.find");
      return Promise.resolve(
        this.receiptRows.get(receiptKey(actorId, operation, key)) ?? null,
      );
    },
    insert: (receipt) => {
      this.calls.push("receipts.insert");
      if (this.failReceiptInsertTimes > 0) {
        this.failReceiptInsertTimes -= 1;
        if (this.winningReceiptOnFailure !== null) {
          // 同時に走った勝った側の書き込みがCOMMITした受領が見える状態にする
          const winner = this.winningReceiptOnFailure;
          this.receiptRows.set(
            receiptKey(
              winner.actorId,
              winner.operation,
              winner.idempotencyKey,
            ),
            winner,
          );
        }
        // pgの一意違反と同じcodeを持つエラー（drizzleはcauseに包む）
        const inner = Object.assign(new Error("duplicate key"), {
          code: "23505",
        });
        const outer = new Error("Failed query: insert");
        (outer as { cause?: unknown }).cause = inner;
        return Promise.reject(outer);
      }
      this.receiptRows.set(
        receiptKey(receipt.actorId, receipt.operation, receipt.idempotencyKey),
        receipt,
      );
      return Promise.resolve();
    },
  };

  readonly planEligibility: PlanEligibilityPort = {
    lockForUpdate: (tripId, planId) => {
      this.calls.push("planEligibility.lockForUpdate");
      const plan = this.planRows.get(planId);
      if (plan === undefined || plan.tripId !== tripId) {
        return Promise.resolve(null);
      }
      return Promise.resolve({
        id: planId,
        tripId: plan.tripId,
        kind: plan.kind,
        cancelledAt: plan.cancelledAt,
      });
    },
  };

  readonly planEvents: PlanEventRepository = {
    findActiveId: (planId, kind) => {
      this.calls.push("planEvents.findActiveId");
      return Promise.resolve(this.activeRows.get(activeKey(planId, kind)) ?? null);
    },
    insert: (event: NewPlanEvent) => {
      this.calls.push("planEvents.insert");
      const stored: PlanEvent = {
        ...event,
        id: `77777777-7777-4777-8777-${String(++this.nextId).padStart(12, "0")}`,
        createdAt: BASE_TIME,
      };
      this.eventRows.set(stored.id, stored);
      return Promise.resolve(stored);
    },
    insertActive: (event) => {
      this.calls.push("planEvents.insertActive");
      if (this.failActiveInsertTimes > 0) {
        this.failActiveInsertTimes -= 1;
        const winner = this.winningActiveOnFailure;
        if (winner !== null) {
          this.activeRows.set(activeKey(winner.planId, winner.kind), winner.eventId);
        }
        const inner = Object.assign(new Error("duplicate key"), {
          code: "23505",
        });
        const outer = new Error("Failed query: insert");
        (outer as { cause?: unknown }).cause = inner;
        return Promise.reject(outer);
      }
      const key = activeKey(event.planId, event.kind);
      if (this.activeRows.has(key)) {
        // 実DBの主キー(plan_id, event_kind)と同じ一意違反
        const inner = Object.assign(new Error("duplicate key"), {
          code: "23505",
        });
        const outer = new Error("Failed query: insert");
        (outer as { cause?: unknown }).cause = inner;
        return Promise.reject(outer);
      }
      this.activeRows.set(key, event.id);
      return Promise.resolve();
    },
    findInTrip: (tripId, eventId) => {
      this.calls.push("planEvents.findInTrip");
      const event = this.eventRows.get(eventId);
      return Promise.resolve(
        event === undefined || event.tripId !== tripId ? null : event,
      );
    },
    findCancellationInTrip: (tripId, eventId) => {
      this.calls.push("planEvents.findCancellationInTrip");
      const cancellation = this.cancellationRows.get(eventId);
      return Promise.resolve(
        cancellation === undefined || cancellation.tripId !== tripId
          ? null
          : cancellation,
      );
    },
    insertCancellation: (cancellation: NewPlanEventCancellation) => {
      this.calls.push("planEvents.insertCancellation");
      const stored: PlanEventCancellation = {
        ...cancellation,
        createdAt: BASE_TIME,
      };
      this.cancellationRows.set(stored.eventId, stored);
      return Promise.resolve(stored);
    },
    deleteActive: (eventId) => {
      this.calls.push("planEvents.deleteActive");
      for (const [key, value] of this.activeRows) {
        if (value === eventId) {
          this.activeRows.delete(key);
        }
      }
      return Promise.resolve();
    },
  };

  /** 二人の参加者がいる旅行を登録する（既定はACTOR・PARTNER）。 */
  seedTrip(tripId = TRIP_ID, memberIds: readonly string[] = [ACTOR, PARTNER]): void {
    this.members.set(tripId, new Set(memberIds));
  }

  seedPlan(
    planId: string,
    tripId: string,
    kind: PlanKind,
    cancelledAt: Date | null = null,
  ): void {
    this.planRows.set(planId, { tripId, kind, cancelledAt });
  }

  seedEvent(event: PlanEvent): void {
    this.eventRows.set(event.id, event);
  }

  seedActive(planId: string, kind: PlanEventKind, eventId: string): void {
    this.activeRows.set(activeKey(planId, kind), eventId);
  }

  seedCancellation(cancellation: PlanEventCancellation): void {
    this.cancellationRows.set(cancellation.eventId, cancellation);
  }

  seedReceipt(receipt: CommandReceipt): void {
    this.receiptRows.set(
      receiptKey(receipt.actorId, receipt.operation, receipt.idempotencyKey),
      receipt,
    );
  }
}

export function inMemoryPlanEventUnitOfWork(
  ctx: InMemoryPlanEventContext,
): UnitOfWork<PlanEventWorkContext> {
  return { run: (work) => work(ctx) };
}
