"use client";

import { useSearchParams } from "next/navigation";
import { RecordsScreen } from "@/screens/records/records-screen";
import { parseRecordsQuery } from "../route-query";

/** 記録の一覧（`?type=`・`?planId=`・`?recordId=&recordType=`）。問い合わせをブラウザで読み、画面に渡す（設計書 screen-speed のSS-06）。 */
export function RecordsRoute({ tripId }: { tripId: string }) {
  const query = parseRecordsQuery(useSearchParams());
  return (
    <RecordsScreen
      tripId={tripId}
      type={query.type}
      planId={query.planId}
      recordId={query.recordId}
      recordType={query.recordType}
    />
  );
}
