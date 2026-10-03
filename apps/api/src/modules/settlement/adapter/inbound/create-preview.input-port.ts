import type { Preview } from "@tomotabi/contracts";
import type { UserId } from "../../../../common/domain/user-id";
import type { IdempotencyKey } from "../../../../common/http/idempotency-key";

export const CREATE_PREVIEW_INPUT_PORT = Symbol("CREATE_PREVIEW_INPUT_PORT");
export const CREATE_PREVIEW_OPERATION = "createSettlementPreview";

export type CreatePreviewInput = Readonly<{
  userId: UserId;
  tripId: string;
  key: IdempotencyKey;
  requestHash: string;
}>;

/**
 * その時点の対象をすべて固定した受け渡しの確認を作る。
 * 対象0件は422（合計0円の確認は作れる）。
 */
export interface CreatePreviewInputPort {
  execute(
    input: CreatePreviewInput,
  ): Promise<{ httpStatus: 200 | 201; body: Preview }>;
}
