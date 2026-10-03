import type { Settlement } from "@tomotabi/contracts";
import type { UserId } from "../../../../common/domain/user-id";
import type { IdempotencyKey } from "../../../../common/http/idempotency-key";

export const COMPLETE_SETTLEMENT_INPUT_PORT = Symbol(
  "COMPLETE_SETTLEMENT_INPUT_PORT",
);
export const COMPLETE_SETTLEMENT_OPERATION = "completeSettlement";

export type CompleteSettlementInput = Readonly<{
  userId: UserId;
  tripId: string;
  key: IdempotencyKey;
  requestHash: string;
  previewId: string;
  completionKind: "transfer_completed" | "no_transfer_required";
  acknowledgedCancellationPaymentIds: readonly string[];
}>;

/**
 * 受け渡しの確認を完了にする。同じ確認の既存の精算は、取り消されて
 * いなければ200でそのまま返す（二人が同時に完了した側）。取り消し
 * 済みなら409。確認のあとに対象が変わっていれば409。
 */
export interface CompleteSettlementInputPort {
  execute(
    input: CompleteSettlementInput,
  ): Promise<{ httpStatus: 200 | 201; body: Settlement }>;
}
