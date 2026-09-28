import type { UnitOfWork } from "../../../../adapter/transaction/unit-of-work";
import type { CommandReceipt } from "../../../../common/idempotency/command-receipt";
import type { IdempotencyKey } from "../../../../common/http/idempotency-key";
import type { UserId } from "../../../../common/domain/user-id";
import type { ParticipantsPort } from "./participants.port";
import type { PlanRepository } from "./plan.repository";
import type { TripRepository } from "./trip.repository";

export const PLANNING_UNIT_OF_WORK = Symbol("PLANNING_UNIT_OF_WORK");

/**
 * receipt の読み書き。(actorId, operation, idempotencyKey) が主キー。
 * insert は同じキーの既存行を更新しない（同時実行は PK 違反で検出する）。
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
 * planning の UseCase に渡す文脈。型付きの Repository・照会・receipt の
 * 限定集合で、生の tx や SQL 実行口は渡さない（設計書「UnitOfWork の文脈」）。
 * M2-b で recordHistory（履歴の有無の照会）が加わる。
 */
export interface PlanningWorkContext {
  trips: TripRepository;
  plans: PlanRepository;
  participants: ParticipantsPort;
  receipts: CommandReceiptStore;
  financeGuards: FinanceGuardWriter;
}

export type PlanningUnitOfWork = UnitOfWork<PlanningWorkContext>;
