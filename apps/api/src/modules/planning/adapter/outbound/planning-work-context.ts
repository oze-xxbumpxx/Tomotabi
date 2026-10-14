import type { UnitOfWork } from "../../../../adapter/transaction/unit-of-work.js";
import type { CommandReceipt } from "../../../../common/idempotency/command-receipt.js";
import type { IdempotencyKey } from "../../../../common/http/idempotency-key.js";
import type { UserId } from "../../../../common/domain/user-id.js";
import type { ParticipantsPort } from "./participants.port.js";
import type { PlanRepository } from "./plan.repository.js";
import type { RecordHistoryPort } from "./record-history.port.js";
import type { TripRepository } from "./trip.repository.js";

export const PLANNING_UNIT_OF_WORK = Symbol("PLANNING_UNIT_OF_WORK");

/**
 * receiptの読み書き。(actorId, operation, idempotencyKey)が主キー。
 * insertは同じキーの既存行を更新しない（同時実行はPK違反で検出する）。
 */
export interface CommandReceiptStore {
  find(
    actorId: UserId,
    operation: string,
    key: IdempotencyKey,
  ): Promise<CommandReceipt | null>;
  insert(receipt: CommandReceipt): Promise<void>;
}

export interface FinanceGuardWriter {
  create(tripId: string): Promise<void>;
}

/**
 * planningのUseCaseに渡す文脈。型付きのRepository・照会・receiptの
 * 限定集合で、生のtxやSQL実行口は渡さない（設計書「UnitOfWorkの文脈」）。
 * recordHistoryは予定行のロックを持ったまま履歴を照会する（E-19）ためここに入れる。
 */
export interface PlanningWorkContext {
  trips: TripRepository;
  plans: PlanRepository;
  participants: ParticipantsPort;
  receipts: CommandReceiptStore;
  financeGuards: FinanceGuardWriter;
  recordHistory: RecordHistoryPort;
}

export type PlanningUnitOfWork = UnitOfWork<PlanningWorkContext>;
