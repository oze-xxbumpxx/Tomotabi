import type { Balance } from "@tomotabi/contracts";
import type { UserId } from "../../../../common/domain/user-id";

export const GET_BALANCE_INPUT_PORT = Symbol("GET_BALANCE_INPUT_PORT");

export type GetBalanceInput = Readonly<{
  userId: UserId;
  tripId: string;
}>;

/**
 * 残額（向き・金額・対象の件数・明細）の取得。参照のみで確認は作らない。
 */
export interface GetBalanceInputPort {
  execute(input: GetBalanceInput): Promise<Balance>;
}
