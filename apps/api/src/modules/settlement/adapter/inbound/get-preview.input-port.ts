import type { Preview } from "@tomotabi/contracts";
import type { UserId } from "../../../../common/domain/user-id";

export const GET_PREVIEW_INPUT_PORT = Symbol("GET_PREVIEW_INPUT_PORT");

export type GetPreviewInput = Readonly<{
  userId: UserId;
  tripId: string;
  previewId: string;
}>;

/**
 * 確認を 1 件返す。元の明細と、取得時点の検証結果（validation）を含む。
 * 無い・別の旅行の確認は同じ 404（存在を漏らさない）。
 */
export interface GetPreviewInputPort {
  execute(input: GetPreviewInput): Promise<Preview>;
}
