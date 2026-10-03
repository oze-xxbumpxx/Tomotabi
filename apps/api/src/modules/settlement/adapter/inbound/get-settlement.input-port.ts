import type { Settlement } from "@tomotabi/contracts";
import type { UserId } from "../../../../common/domain/user-id";

export const GET_SETTLEMENT_INPUT_PORT = Symbol("GET_SETTLEMENT_INPUT_PORT");

export type GetSettlementInput = Readonly<{
  userId: UserId;
  tripId: string;
  settlementId: string;
}>;

/**
 * 精算を 1 件返す。元の明細・記録した人・取り消し履歴を含む。
 * 無い・別の旅行の精算は同じ 404（存在を漏らさない）。
 */
export interface GetSettlementInputPort {
  execute(input: GetSettlementInput): Promise<Settlement>;
}
