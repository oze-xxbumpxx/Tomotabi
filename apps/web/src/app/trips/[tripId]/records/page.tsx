import { notFound } from "next/navigation";
import { RecordsScreen } from "@/screens/records/records-screen";
import { isUuidString } from "@/shared/lib/uuid";
import type { ListRecordsType } from "@/features/records";

const RECORD_TYPES: ReadonlyArray<ListRecordsType> = [
  "achievement",
  "booking",
  "payment",
];

/**
 * 記録の一覧（/trips/{tripId}/records）。
 * `?type=`で支払い・達成・予約に絞り、`?planId=`で予定に絞る。
 * `?recordId=&recordType=`は「この記録に絞り込み」（計画の詳細の
 * 行・取り消しの行から遷移）。recordTypeの無いrecordIdや、
 * recordTypeの無いrecordIdの形の合わない指定は無かったことにする。
 */
export default async function RecordsPage({
  params,
  searchParams,
}: {
  params: Promise<{ tripId: string }>;
  searchParams: Promise<{
    type?: string | string[];
    planId?: string | string[];
    recordId?: string | string[];
    recordType?: string | string[];
  }>;
}) {
  const { tripId } = await params;
  if (!isUuidString(tripId)) {
    notFound();
  }
  const raw = await searchParams;
  const first = (value: string | string[] | undefined): string | null => {
    const s = Array.isArray(value) ? value[0] : value;
    return typeof s === "string" && s !== "" ? s : null;
  };

  const rawType = first(raw.type);
  const type: ListRecordsType | null =
    rawType !== null &&
    (RECORD_TYPES as ReadonlyArray<string>).includes(rawType)
      ? (rawType as ListRecordsType)
      : null;
  const rawPlanId = first(raw.planId);
  const planId =
    rawPlanId !== null && isUuidString(rawPlanId) ? rawPlanId : null;
  const rawRecordId = first(raw.recordId);
  const rawRecordType = first(raw.recordType);
  const recordId =
    rawRecordId !== null && isUuidString(rawRecordId) ? rawRecordId : null;
  const recordType: ListRecordsType | null =
    rawRecordType !== null &&
    (RECORD_TYPES as ReadonlyArray<string>).includes(rawRecordType)
      ? (rawRecordType as ListRecordsType)
      : null;

  return (
    <RecordsScreen
      tripId={tripId}
      type={type}
      planId={planId}
      recordId={recordType !== null ? recordId : null}
      recordType={recordId !== null ? recordType : null}
    />
  );
}
