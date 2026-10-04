import type { Records } from "@tomotabi/contracts";
import type { UserId } from "../../../../common/domain/user-id";
import type { RecordType } from "../outbound/records-read.port";

export const LIST_RECORDS_INPUT_PORT = Symbol("LIST_RECORDS_INPUT_PORT");

export type ListRecordsInput = Readonly<{
  userId: UserId;
  tripId: string;
  /** 元の記録の種類。無指定はnull。 */
  type: RecordType | null;
  planId: string | null;
  /** 指定時は元の記録とその取り消しの最大2件を返す（type必須）。 */
  recordId: string | null;
  /** サーバー発行の不透明カーソル。最初のページはnull。 */
  cursor: string | null;
  /**
   * 利用者が明示したlimit。省略はnull。
   * recordIdとの併用を断るため、既定値とは区別する（E-06）。
   */
  limit: number | null;
}>;

/**
 * 旅行の記録の一覧。支払い・達成・予約とそれぞれの取り消しを、
 * 登録日時の新しい順（同じ日時は種類・IDの順）に返す。
 * recordId指定時は元の記録とその取り消しの最大2件を返す。
 */
export interface ListRecordsInputPort {
  execute(input: ListRecordsInput): Promise<Records>;
}
