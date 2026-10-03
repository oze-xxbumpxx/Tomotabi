import type { Cancellation } from "@tomotabi/contracts";
import type { UserId } from "../../../../common/domain/user-id";
import type { IdempotencyKey } from "../../../../common/http/idempotency-key";

export const CANCEL_SETTLEMENT_INPUT_PORT = Symbol(
  "CANCEL_SETTLEMENT_INPUT_PORT",
);
export const CANCEL_SETTLEMENT_OPERATION = "cancelSettlement";

export type CancelSettlementInput = Readonly<{
  userId: UserId;
  tripId: string;
  settlementId: string;
  key: IdempotencyKey;
  requestHash: string;
}>;

/**
 * 最新の有効な精算を取り消す。取り消しの追記と占有の削除は同じ
 * トランザクション。取り消し済みなら 200 で既存の取り消しを返す。
 * 最新でなければ 409。
 */
export interface CancelSettlementInputPort {
  execute(
    input: CancelSettlementInput,
  ): Promise<{ httpStatus: 200 | 201; body: Cancellation }>;
}
