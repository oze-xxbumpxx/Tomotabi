"use client";

import { useSearchParams } from "next/navigation";
import { PlanDetailScreen } from "@/screens/plan-detail/plan-detail-screen";
import { parsePlanDetailQuery } from "../../route-query";

/** 予定の詳細（`?from=`）。問い合わせをブラウザで読み、画面に渡す（設計書 screen-speed のSS-06）。 */
export function PlanDetailRoute({ tripId, planId }: { tripId: string; planId: string }) {
  const query = parsePlanDetailQuery(useSearchParams());
  return (
    <PlanDetailScreen tripId={tripId} planId={planId} from={query.from} />
  );
}
