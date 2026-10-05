import type { BalanceSummary, TimelineItem } from "@tomotabi/contracts";
import type { UnitOfWork } from "../../src/adapter/transaction/unit-of-work";
import type { LocalDate } from "../../src/common/domain/local-date";
import type {
  HomeBalancePort,
} from "../../src/modules/planning/adapter/outbound/home-balance.port";
import {
  isUnrecoverableHomeReadError,
  type HomeLog,
  type HomeReadContext,
  type HomeRosterEntry,
  type HomeScheduleReadPort,
  type HomeSectionResult,
  type HomeTripReadPort,
} from "../../src/modules/planning/adapter/outbound/home-read.port";
import type { HomeRecordsPort } from "../../src/modules/planning/adapter/outbound/home-records.port";
import type { PlanView } from "../../src/modules/planning/adapter/outbound/planning-read.port";
import type { Trip } from "../../src/modules/planning/domain/trip";
import { ACTOR, PARTNER } from "./planning-context";

export const TRIP_ID = "99999999-9999-4999-8999-999999999999";
export const PLAN_ID = "88888888-8888-4888-8888-888888888888";

/**
 * ホームのUseCase試験用のインメモリ文脈。呼び出し順をcallsに記録し、
 * 欄の失敗はfailOnで差し込む。runSectionは本物のUoWと同じ決まり:
 * 回復できる失敗はfailed、回復できない失敗（接続が切れた・認証の失敗）
 * はそのまま投げる。
 */
export class InMemoryHomeReadContext implements HomeReadContext {
  readonly calls: string[] = [];
  tripRow: { trip: Trip; roster: HomeRosterEntry[] } | null = null;
  planViews: PlanView[] = [];
  balanceRow: BalanceSummary | null = null;
  recordRows: TimelineItem[] = [];
  /** 欄ごとに差し込む失敗（読み取りの代わりにこの誤りを投げる）。 */
  readonly failOn = new Map<string, unknown>();

  readonly trip: HomeTripReadPort = {
    find: (tripId, actorId) => {
      this.calls.push("trip.find");
      const row = this.tripRow;
      if (row === null || row.trip.id !== tripId) {
        return Promise.resolve(null);
      }
      return Promise.resolve(
        row.roster.some((entry) => entry.userId === actorId) ? row : null,
      );
    },
  };

  readonly schedule: HomeScheduleReadPort = {
    listForDay: (tripId: string, _date: LocalDate) => {
      this.calls.push("schedule.listForDay");
      const failure = this.failOn.get("schedule");
      if (failure !== undefined) {
        return Promise.reject(failure);
      }
      return Promise.resolve(
        this.planViews.filter((view) => view.plan.tripId === tripId),
      );
    },
  };

  readonly balance: HomeBalancePort = {
    findSummary: (_tripId: string, _roster: readonly HomeRosterEntry[]) => {
      this.calls.push("balance.findSummary");
      const failure = this.failOn.get("balance");
      if (failure !== undefined) {
        return Promise.reject(failure);
      }
      return Promise.resolve(
        this.balanceRow ?? {
          transfer: {
            signedTotalYen: "0",
            amountYen: "0",
            fromUserId: null,
            toUserId: null,
            requiresTransfer: false,
          },
          targetCount: 0,
        },
      );
    },
  };

  readonly records: HomeRecordsPort = {
    listRecent: (_tripId: string, _roster: readonly HomeRosterEntry[]) => {
      this.calls.push("records.listRecent");
      const failure = this.failOn.get("recentRecords");
      if (failure !== undefined) {
        return Promise.reject(failure);
      }
      return Promise.resolve(this.recordRows.slice(0, 3));
    },
  };

  async runSection<T>(work: () => Promise<T>): Promise<HomeSectionResult<T>> {
    try {
      return { status: "ok", data: await work() };
    } catch (error) {
      if (isUnrecoverableHomeReadError(error)) {
        throw error;
      }
      return { status: "failed", error };
    }
  }

  /**
   * ACTORを参加者に持つ旅行を登録する（rosterはACTOR slot0・PARTNER
   * slot1の既定の二人組）。
   */
  seedTrip(trip: Trip, roster?: HomeRosterEntry[]): void {
    this.tripRow = {
      trip,
      roster:
        roster ??
        [
          { slot: 0, userId: ACTOR, displayName: "act" },
          { slot: 1, userId: PARTNER, displayName: "partner" },
        ],
    };
  }
}

export function inMemoryHomeReadUnitOfWork(
  ctx: InMemoryHomeReadContext,
): UnitOfWork<HomeReadContext> {
  return { run: (work) => work(ctx) };
}

/** 欄の失敗の記録（warn）の試験用実装。 */
export class RecordingHomeLog implements HomeLog {
  readonly entries: { section: string; errorKind: string }[] = [];

  warn(entry: { section: string; errorKind: string }): void {
    this.entries.push(entry);
  }
}
