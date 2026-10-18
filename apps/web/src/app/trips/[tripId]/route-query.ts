import type { ListRecordsType } from "@/features/records";
import { parseFocusSettlementId } from "@/screens/settlement/focus-settlement-id";
import { isLocalDateString } from "@/shared/lib/local-date";
import { isUuidString } from "@/shared/lib/uuid";

/**
 * 旅行の下の画面のURLの問い合わせの読み解き。以前は各`page.tsx`がサーバーで
 * `searchParams`を読んでいたが、画面の部品をCDNから配るため、ブラウザで
 * `useSearchParams()`から読む形にした（設計書 screen-speed のSS-06）。
 * 読み解き方は以前の`page.tsx`と同じ。同じ名前が複数あるときは先頭を見る。
 */
export type QueryReader = { getAll(name: string): string[] };

function first(query: QueryReader, name: string): string | null {
  const value = query.getAll(name)[0];
  return value !== undefined && value !== "" ? value : null;
}

/** しおり（`?date=`）。実在する`YYYY-MM-DD`のときだけ渡し、ほかはnull（サーバー既定の日）。 */
export function parseItineraryQuery(query: QueryReader): { date: string | null } {
  const candidate = first(query, "date");
  return {
    date: candidate !== null && isLocalDateString(candidate) ? candidate : null,
  };
}

const RECORD_TYPES: ReadonlyArray<ListRecordsType> = [
  "achievement",
  "booking",
  "payment",
];

function recordTypeOf(value: string | null): ListRecordsType | null {
  return value !== null &&
    (RECORD_TYPES as ReadonlyArray<string>).includes(value)
    ? (value as ListRecordsType)
    : null;
}

function uuidOf(value: string | null): string | null {
  return value !== null && isUuidString(value) ? value : null;
}

/**
 * 記録の一覧。`?type=`で種類、`?planId=`で予定に絞る。
 * `?recordId=&recordType=`は両方そろって形が正しいときだけ「この記録に絞り込み」にする。
 */
export function parseRecordsQuery(query: QueryReader): {
  type: ListRecordsType | null;
  planId: string | null;
  recordId: string | null;
  recordType: ListRecordsType | null;
} {
  const recordId = uuidOf(first(query, "recordId"));
  const recordType = recordTypeOf(first(query, "recordType"));
  return {
    type: recordTypeOf(first(query, "type")),
    planId: uuidOf(first(query, "planId")),
    recordId: recordType !== null ? recordId : null,
    recordType: recordId !== null ? recordType : null,
  };
}

/** 精算（`?settlementId=`）。通知から開いた1件を目立たせる。 */
export function parseSettlementQuery(query: QueryReader): {
  focusSettlementId: string | null;
} {
  return { focusSettlementId: parseFocusSettlementId(query.getAll("settlementId")) };
}

/** 予定の追加（`?date=`）。空でなければそのまま渡す（日付の確かめは画面が行う）。 */
export function parsePlanNewQuery(query: QueryReader): { date: string | null } {
  return { date: first(query, "date") };
}

/** 予定の詳細（`?from=`）。空でなければそのまま渡す。 */
export function parsePlanDetailQuery(query: QueryReader): { from: string | null } {
  return { from: first(query, "from") };
}

/** 支払いを記録（`?planId=&from=`）。どちらもUUIDの形のときだけ渡す。 */
export function parsePaymentNewQuery(query: QueryReader): {
  planId: string | null;
  fromPaymentId: string | null;
} {
  return {
    planId: uuidOf(query.getAll("planId")[0] ?? null),
    fromPaymentId: uuidOf(query.getAll("from")[0] ?? null),
  };
}
