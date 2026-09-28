import type { Clock } from "../../src/adapter/clock/clock";
import type { UnitOfWork } from "../../src/adapter/transaction/unit-of-work";
import { BoundedText } from "../../src/common/domain/bounded-text";
import { LocalDate } from "../../src/common/domain/local-date";
import { UserId } from "../../src/common/domain/user-id";
import type { CommandReceipt } from "../../src/common/idempotency/command-receipt";
import type { IdempotencyKey } from "../../src/common/http/idempotency-key";
import type { AllowlistParticipant, ParticipantsPort } from "../../src/modules/planning/adapter/outbound/participants.port";
import type { NewPlan, PlanRepository } from "../../src/modules/planning/adapter/outbound/plan.repository";
import type {
  ActivePlanEvent,
  RecordHistoryPort,
} from "../../src/modules/planning/adapter/outbound/record-history.port";
import type { TripParticipantSlot, TripRepository } from "../../src/modules/planning/adapter/outbound/trip.repository";
import type {
  CommandReceiptStore,
  FinanceGuardWriter,
  PlanningWorkContext,
} from "../../src/modules/planning/adapter/outbound/planning-work-context";
import type { WriteLog, WriteLogEntry } from "../../src/modules/planning/adapter/outbound/write-log.port";
import type { Plan } from "../../src/modules/planning/domain/plan";
import type { Trip } from "../../src/modules/planning/domain/trip";
import { TripPeriod } from "../../src/modules/planning/domain/trip-period";

export const ACTOR = UserId.parse("00000000-0000-4000-8000-000000000001");
export const PARTNER = UserId.parse("00000000-0000-4000-8000-000000000002");
export const KEY = "11111111-1111-4111-8111-111111111111" as IdempotencyKey;

const BASE_TIME = new Date("2026-09-01T00:00:00.000Z");

export function testTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: "99999999-9999-4999-8999-999999999999",
    name: BoundedText.parse("京都 2 泊", 100),
    period: TripPeriod.create(
      LocalDate.parse("2026-09-10"),
      LocalDate.parse("2026-09-12"),
    ),
    status: "planning",
    version: 1,
    createdBy: ACTOR,
    createdAt: BASE_TIME,
    updatedAt: BASE_TIME,
    startedAt: null,
    startedBy: null,
    finishedAt: null,
    finishedBy: null,
    ...overrides,
  };
}

export function testPlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: "88888888-8888-4888-8888-888888888888",
    tripId: "99999999-9999-4999-8999-999999999999",
    name: BoundedText.parse("清水寺", 100),
    kind: "place",
    date: LocalDate.parse("2026-09-11"),
    time: null,
    memo: null,
    cancelledAt: null,
    cancelledBy: null,
    version: 1,
    createdAt: BASE_TIME,
    updatedAt: BASE_TIME,
    ...overrides,
  };
}

function receiptKey(actorId: UserId, operation: string, key: IdempotencyKey): string {
  return `${actorId}|${operation}|${key}`;
}

/**
 * UseCase 試験用のインメモリ文脈。メソッドの呼び出し順を calls に記録し、
 * U-19（ロック順序）が検査できるようにする。
 */
export class InMemoryPlanningContext implements PlanningWorkContext {
  readonly calls: string[] = [];
  readonly tripRows = new Map<string, Trip>();
  private readonly members = new Map<string, Set<string>>();
  readonly insertedParticipants = new Map<string, TripParticipantSlot[]>();
  readonly receiptRows = new Map<string, CommandReceipt>();
  readonly guardRows: string[] = [];
  readonly planRows = new Map<string, Plan>();
  readonly historyPlanIds = new Set<string>();
  readonly activeEventRows = new Map<
    string,
    { achievement: ActivePlanEvent | null; booking: ActivePlanEvent | null }
  >();
  allowlistRows: AllowlistParticipant[] = [];
  outsideDates: LocalDate[] = [];
  private nextId = 0;
  private nextPlanId = 0;

  readonly trips: TripRepository = {
    lockForUpdate: (tripId, actorId) => {
      this.calls.push("trips.lockForUpdate");
      return Promise.resolve(this.read(tripId, actorId));
    },
    lockForShare: (tripId, actorId) => {
      this.calls.push("trips.lockForShare");
      return Promise.resolve(this.read(tripId, actorId));
    },
    insert: (trip) => {
      this.calls.push("trips.insert");
      const stored: Trip = {
        id: `00000000-0000-4000-8000-${String(++this.nextId).padStart(12, "0")}`,
        name: trip.name,
        period: trip.period,
        status: "planning",
        version: 1,
        createdBy: trip.createdBy,
        createdAt: BASE_TIME,
        updatedAt: BASE_TIME,
        startedAt: null,
        startedBy: null,
        finishedAt: null,
        finishedBy: null,
      };
      this.tripRows.set(stored.id, stored);
      return Promise.resolve(stored);
    },
    insertParticipants: (tripId, participants) => {
      this.calls.push("trips.insertParticipants");
      this.insertedParticipants.set(tripId, [...participants]);
      this.members.set(
        tripId,
        new Set(participants.map((participant) => participant.userId)),
      );
      return Promise.resolve();
    },
    update: (trip) => {
      this.calls.push("trips.update");
      this.tripRows.set(trip.id, trip);
      return Promise.resolve();
    },
  };

  readonly plans: PlanRepository = {
    datesOutside: () => {
      this.calls.push("plans.datesOutside");
      return Promise.resolve(this.outsideDates);
    },
    lockForUpdate: (tripId, planId) => {
      this.calls.push("plans.lockForUpdate");
      const plan = this.planRows.get(planId);
      if (plan === undefined || plan.tripId !== tripId) {
        return Promise.resolve(null);
      }
      return Promise.resolve(plan);
    },
    insert: (plan: NewPlan) => {
      this.calls.push("plans.insert");
      const stored: Plan = {
        id: `77777777-7777-4777-8777-${String(++this.nextPlanId).padStart(12, "0")}`,
        tripId: plan.tripId,
        name: plan.name,
        kind: plan.kind,
        date: plan.date,
        time: plan.time,
        memo: plan.memo,
        cancelledAt: null,
        cancelledBy: null,
        version: 1,
        createdAt: BASE_TIME,
        updatedAt: BASE_TIME,
      };
      this.planRows.set(stored.id, stored);
      return Promise.resolve(stored);
    },
    update: (plan) => {
      this.calls.push("plans.update");
      this.planRows.set(plan.id, plan);
      return Promise.resolve();
    },
  };

  readonly recordHistory: RecordHistoryPort = {
    hasHistory: (planId) => {
      this.calls.push("recordHistory.hasHistory");
      return Promise.resolve(this.historyPlanIds.has(planId));
    },
    activeEvents: (planId) => {
      this.calls.push("recordHistory.activeEvents");
      return Promise.resolve(
        this.activeEventRows.get(planId) ?? {
          achievement: null,
          booking: null,
        },
      );
    },
  };

  readonly participants: ParticipantsPort = {
    listEnabled: () => {
      this.calls.push("participants.listEnabled");
      return Promise.resolve(this.allowlistRows);
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
      const key = receiptKey(
        receipt.actorId,
        receipt.operation,
        receipt.idempotencyKey,
      );
      if (this.receiptRows.has(key)) {
        const error = new Error("duplicate key value violates unique constraint");
        (error as { code?: string }).code = "23505";
        return Promise.reject(error);
      }
      this.receiptRows.set(key, receipt);
      return Promise.resolve();
    },
  };

  readonly financeGuards: FinanceGuardWriter = {
    create: (tripId) => {
      this.calls.push("financeGuards.create");
      this.guardRows.push(tripId);
      return Promise.resolve();
    },
  };

  private read(tripId: string, actorId: UserId): Trip | null {
    const trip = this.tripRows.get(tripId);
    if (trip === undefined) {
      return null;
    }
    const members = this.members.get(tripId);
    if (members === undefined || !members.has(actorId)) {
      return null;
    }
    return trip;
  }

  seedTrip(trip: Trip, memberIds: readonly string[]): void {
    this.tripRows.set(trip.id, trip);
    this.members.set(trip.id, new Set(memberIds));
  }

  seedPlan(plan: Plan): void {
    this.planRows.set(plan.id, plan);
  }

  seedHistory(planId: string): void {
    this.historyPlanIds.add(planId);
  }

  seedReceipt(receipt: CommandReceipt): void {
    this.receiptRows.set(
      receiptKey(receipt.actorId, receipt.operation, receipt.idempotencyKey),
      receipt,
    );
  }
}

export function inMemoryUnitOfWork(
  ctx: InMemoryPlanningContext,
): UnitOfWork<PlanningWorkContext> {
  return { run: (work) => work(ctx) };
}

export function fixedClock(at = "2026-09-05T12:00:00.000Z"): Clock {
  const now = new Date(at);
  return {
    now: () => now,
    today: () => LocalDate.parse("2026-09-05"),
  };
}

export class RecordingWriteLog implements WriteLog {
  readonly entries: WriteLogEntry[] = [];

  info(entry: WriteLogEntry): void {
    this.entries.push(entry);
  }
}
