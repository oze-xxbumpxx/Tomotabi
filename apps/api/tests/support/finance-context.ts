import type { UnitOfWork } from "../../src/adapter/transaction/unit-of-work";
import type { ParticipantSlot } from "../../src/common/domain/participant-slot";
import type { UserId } from "../../src/common/domain/user-id";
import type { CommandReceipt } from "../../src/common/idempotency/command-receipt";
import type { IdempotencyKey } from "../../src/common/http/idempotency-key";
import type { CommandReceiptStore } from "../../src/modules/planning/adapter/outbound/planning-work-context";
import type {
  FinanceGuardLocker,
  FinanceWorkContext,
  TripPlansPort,
  TripRosterEntry,
  TripRosterPort,
} from "../../src/modules/record/adapter/outbound/finance-work-context";
import type { PaymentRepository } from "../../src/modules/record/adapter/outbound/payment.repository";
import type {
  Payment,
  PaymentCancellation,
} from "../../src/modules/record/domain/payment";
import { ACTOR, PARTNER } from "./planning-context";

const BASE_TIME = new Date("2026-09-01T00:00:00.000Z");

export const TRIP_ID = "99999999-9999-4999-8999-999999999999";
export const PLAN_ID = "88888888-8888-4888-8888-888888888888";

function receiptKey(actorId: UserId, operation: string, key: IdempotencyKey): string {
  return `${actorId}|${operation}|${key}`;
}

/**
 * 財務 UseCase 試験用のインメモリ文脈。メソッドの呼び出し順を calls に記録し、
 * FU-10（guard の行ロック → receipt → 対象の読み取り → 保存の順序）が
 * 検査できるようにする。
 */
export class InMemoryFinanceContext implements FinanceWorkContext {
  readonly calls: string[] = [];
  private readonly rosterRows = new Map<string, TripRosterEntry[]>();
  readonly receiptRows = new Map<string, CommandReceipt>();
  readonly paymentRows = new Map<string, Payment>();
  readonly cancellationRows = new Map<string, PaymentCancellation>();
  readonly planRows = new Map<string, string>();
  private nextId = 0;
  /** receipts.insert で 23505 を投げさせる回数（一意違反の試験用） */
  failReceiptInsertTimes = 0;
  /**
   * 失敗させたときに勝った側が COMMIT したと見なす受領。null なら受領は
   * まだ無い（読み直しで元のエラーを投げ直す経路の確認用）。
   */
  winningReceiptOnFailure: CommandReceipt | null = null;

  readonly roster: TripRosterPort = {
    find: (tripId, actorId) => {
      this.calls.push("roster.find");
      const entries = this.rosterRows.get(tripId) ?? [];
      return Promise.resolve(
        entries.some((entry) => entry.userId === actorId) ? entries : null,
      );
    },
  };

  readonly financeGuard: FinanceGuardLocker = {
    lock: () => {
      this.calls.push("financeGuard.lock");
      return Promise.resolve();
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
          // 同時に走った勝った側の書き込みが COMMIT した受領が見える状態にする
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
        // pg の一意違反と同じ code を持つエラー（drizzle は cause に包む）
        const inner = Object.assign(new Error("duplicate key"), {
          code: "23505",
        });
        const outer = new Error("Failed query: insert");
        (outer as { cause?: unknown }).cause = inner;
        return Promise.reject(outer);
      }
      const key = receiptKey(
        receipt.actorId,
        receipt.operation,
        receipt.idempotencyKey,
      );
      this.receiptRows.set(key, receipt);
      return Promise.resolve();
    },
  };

  readonly payments: PaymentRepository = {
    insert: (payment) => {
      this.calls.push("payments.insert");
      const stored: Payment = {
        ...payment,
        id: `77777777-7777-4777-8777-${String(++this.nextId).padStart(12, "0")}`,
        createdAt: BASE_TIME,
      };
      this.paymentRows.set(stored.id, stored);
      return Promise.resolve(stored);
    },
    findInTrip: (tripId, paymentId) => {
      this.calls.push("payments.findInTrip");
      const payment = this.paymentRows.get(paymentId);
      return Promise.resolve(
        payment === undefined || payment.tripId !== tripId ? null : payment,
      );
    },
    findCancellationInTrip: (tripId, paymentId) => {
      this.calls.push("payments.findCancellationInTrip");
      const cancellation = this.cancellationRows.get(paymentId);
      return Promise.resolve(
        cancellation === undefined || cancellation.tripId !== tripId
          ? null
          : cancellation,
      );
    },
    insertCancellation: (cancellation) => {
      this.calls.push("payments.insertCancellation");
      const stored: PaymentCancellation = {
        ...cancellation,
        createdAt: BASE_TIME,
      };
      this.cancellationRows.set(stored.paymentId, stored);
      return Promise.resolve(stored);
    },
  };

  readonly plans: TripPlansPort = {
    existsInTrip: (tripId, planId) => {
      this.calls.push("plans.existsInTrip");
      return Promise.resolve(this.planRows.get(planId) === tripId);
    },
  };

  /** 二人の参加者がいる旅行を登録する（既定は ACTOR slot0・PARTNER slot1）。 */
  seedTrip(tripId = TRIP_ID, members?: { slot0: UserId; slot1: UserId }): void {
    const slot0 = members?.slot0 ?? ACTOR;
    const slot1 = members?.slot1 ?? PARTNER;
    this.rosterRows.set(tripId, [
      { slot: 0 as ParticipantSlot, userId: slot0 },
      { slot: 1 as ParticipantSlot, userId: slot1 },
    ]);
  }

  seedPlan(planId: string, tripId: string): void {
    this.planRows.set(planId, tripId);
  }

  seedPayment(payment: Payment): void {
    this.paymentRows.set(payment.id, payment);
  }

  seedReceipt(receipt: CommandReceipt): void {
    this.receiptRows.set(
      receiptKey(receipt.actorId, receipt.operation, receipt.idempotencyKey),
      receipt,
    );
  }
}

export function inMemoryFinanceUnitOfWork(
  ctx: InMemoryFinanceContext,
): UnitOfWork<FinanceWorkContext> {
  return { run: (work) => work(ctx) };
}
