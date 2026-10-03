import type { UnitOfWork } from "../../../../adapter/transaction/unit-of-work";
import type {
  FinanceWorkContext,
  TripRosterPort,
} from "../../../record/adapter/outbound/finance-work-context";
import type { PaymentsReadPort } from "./payments-read.port";
import type { SettlementRepository } from "./settlement.repository";

export const SETTLEMENT_UNIT_OF_WORK = Symbol("SETTLEMENT_UNIT_OF_WORK");
export const SETTLEMENT_READ_UNIT_OF_WORK = Symbol(
  "SETTLEMENT_READ_UNIT_OF_WORK",
);

/**
 * 確認・精算の書き込みの文脈。財務共通の文脈（設計書「UnitOfWorkの文脈」）
 * に、支払いの読み取り口とsettlementのRepositoryを足したもの。
 * PgFinanceUnitOfWorkがこの文脈を組み立て、recordのUseCaseは
 * FinanceWorkContextの面だけを使う。
 */
export interface SettlementWorkContext extends FinanceWorkContext {
  paymentsRead: PaymentsReadPort;
  settlements: SettlementRepository;
}

export type SettlementUnitOfWork = UnitOfWork<SettlementWorkContext>;

/**
 * 残額・確認の読み取りの文脈。REPEATABLE READの短い読み取り
 * トランザクションで、1つのスナップショットから組み立てる（設計書
 * 「読み取り」）。書き込みの口は持たない。
 */
export interface SettlementReadContext {
  roster: TripRosterPort;
  paymentsRead: PaymentsReadPort;
  settlements: SettlementRepository;
}

export type SettlementReadUnitOfWork = UnitOfWork<SettlementReadContext>;
