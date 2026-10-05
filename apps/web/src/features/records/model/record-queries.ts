import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ApiRequestError } from "@/shared/api/api-failure";
import { listRecordsPage } from "../api/records-api";
import type { EventKind, ListRecordsType } from "../api/records-api";

/**
 * 記録の一覧の絞り込み。typeは元の記録の種類（指定するとその種類と
 * その取り消しだけを返す）、planIdはその予定に結びついた記録だけ。
 * recordIdの指定は「この記録に絞り込み」の表示で、typeと組で使う
 * （元の記録とその取り消しの最大2件。ページングはしない）。
 */
export type RecordsFilter = {
  type: ListRecordsType | null;
  planId: string | null;
  /** 「この記録に絞り込み」の記録のID。typeが必須。 */
  recordId: string | null;
};

/** 1回に読む件数（契約の既定と同じ20）。 */
const RECORDS_PAGE_LIMIT = 20;

/** その予定に結びついた支払いの表示に読む件数（新しい順に最大3件出す）。 */
const PLAN_PAYMENTS_LIMIT = 10;

/**
 * 記録の一覧のキーは`["records", tripId, 絞り込み]`。書き込みの成功で
 * `["records", tripId]`の前方一致を無効化する（records.js参照）。
 * 「この記録に絞り込み」の一覧とその予定の支払いもこのキーの系統。
 */
export const recordsQueryKey = (tripId: string, filter: RecordsFilter) =>
  [
    "records",
    tripId,
    filter.type ?? "all",
    filter.planId,
    filter.recordId,
  ] as const;

const planPaymentsQueryKey = (tripId: string, planId: string) =>
  ["records", tripId, "plan-payments", planId] as const;

/**
 * 記録の一覧（GET /trips/{tripId}/records）。再取得中は前回の表示を残し、
 * 失敗は前回表示に添える。末尾に近づいたら次のページを読む。
 */
export function useRecords(tripId: string, filter: RecordsFilter) {
  return useInfiniteQuery({
    queryKey: recordsQueryKey(tripId, filter),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      listRecordsPage(
        tripId,
        filter.recordId !== null
          ? // 「この記録に絞り込み」はrecordIdとtypeだけを送る
            // （契約上cursor・limitと組み合わせられない）。
            { type: filter.type ?? undefined, recordId: filter.recordId }
          : {
              type: filter.type ?? undefined,
              planId: filter.planId ?? undefined,
              cursor: pageParam ?? undefined,
              limit: RECORDS_PAGE_LIMIT,
            },
      ).match(
        (page) => page,
        (failure) => {
          throw new ApiRequestError(failure);
        },
      ),
    getNextPageParam: (page) => page.nextCursor,
  });
}

/**
 * 記録1件とその取り消し（recordIdの一覧API）。取り消しの行から
 * 元の記録の中身を開くときに使う。
 */
export function useRecordItems(
  tripId: string,
  type: EventKind,
  recordId: string,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: ["records", tripId, "item", type, recordId] as const,
    enabled: options?.enabled ?? true,
    queryFn: () =>
      listRecordsPage(tripId, { type, recordId }).match(
        (page) => page.items,
        (failure) => {
          throw new ApiRequestError(failure);
        },
      ),
  });
}

/**
 * その予定に結びついた支払い（新しい順）。予定の詳細の
 * 「関連する支払い」に使い、元の記録だけを最大3件返す
 * （取り消しの行は表示しない）。
 */
export function usePlanPayments(tripId: string, planId: string) {
  return useQuery({
    queryKey: planPaymentsQueryKey(tripId, planId),
    queryFn: () =>
      listRecordsPage(tripId, {
        type: "payment",
        planId,
        limit: PLAN_PAYMENTS_LIMIT,
      }).match(
        (page) =>
          page.items.filter((item) => item.kind === "payment").slice(0, 3),
        (failure) => {
          throw new ApiRequestError(failure);
        },
      ),
  });
}
