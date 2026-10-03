import type { SettlementPage } from "@tomotabi/contracts";
import type { UserId } from "../../../../common/domain/user-id";

export const LIST_SETTLEMENTS_INPUT_PORT = Symbol("LIST_SETTLEMENTS_INPUT_PORT");

export type ListSettlementsInput = Readonly<{
  userId: UserId;
  tripId: string;
  /** サーバー発行の不透明カーソル。最初のページは null。 */
  cursor: string | null;
  limit: number;
}>;

/**
 * 旅行の精算の履歴を旅行内連番の降順（新しい順）で一覧する。
 * 取り消し済みを含み、各件に取り消し状態と取り消せるかを付ける。
 */
export interface ListSettlementsInputPort {
  execute(input: ListSettlementsInput): Promise<SettlementPage>;
}
