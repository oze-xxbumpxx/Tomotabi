import type { ListRecordsType } from "../api/records-api";

/** `/records`の絞り込み。`parseRecordsQuery`が返す形と同じ。 */
export type RecordsFilterQuery = {
  type: ListRecordsType | null;
  planId: string | null;
  recordId: string | null;
  recordType: ListRecordsType | null;
};

/** `/records`へ戻すときの問い合わせ。絞り込みが無ければ空文字。 */
export function recordsFilterQueryString(filter: RecordsFilterQuery): string {
  const params = new URLSearchParams();
  if (filter.type !== null) {
    params.set("type", filter.type);
  }
  if (filter.planId !== null) {
    params.set("planId", filter.planId);
  }
  if (filter.recordId !== null && filter.recordType !== null) {
    params.set("recordId", filter.recordId);
    params.set("recordType", filter.recordType);
  }
  return params.toString();
}
