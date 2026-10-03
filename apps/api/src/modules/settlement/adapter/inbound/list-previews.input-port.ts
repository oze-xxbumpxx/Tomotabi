import type { PreviewPage } from "@tomotabi/contracts";
import type { UserId } from "../../../../common/domain/user-id";

export const LIST_PREVIEWS_INPUT_PORT = Symbol("LIST_PREVIEWS_INPUT_PORT");

export type ListPreviewsInput = Readonly<{
  userId: UserId;
  tripId: string;
  status: "pending";
  /** サーバー発行の不透明カーソル。最初のページはnull。 */
  cursor: string | null;
  limit: number;
}>;

/**
 * 自分が作った未完了の確認を新しい順に一覧する。完了した・完了後に
 * 取り消された確認は除く。競合で無効になった確認も理由つきで返す。
 */
export interface ListPreviewsInputPort {
  execute(input: ListPreviewsInput): Promise<PreviewPage>;
}
