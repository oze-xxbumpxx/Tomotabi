"use client";

import { useSearchParams } from "next/navigation";
import { PlanFormScreen } from "@/screens/plan-form/plan-form-screen";
import { parsePlanNewQuery } from "../../route-query";

/** 予定の追加（`?date=`）。問い合わせをブラウザで読み、画面に渡す（設計書 screen-speed のSS-06）。 */
export function PlanNewRoute({ tripId }: { tripId: string }) {
  const query = parsePlanNewQuery(useSearchParams());
  return (
    <PlanFormScreen mode="new" tripId={tripId} date={query.date} />
  );
}
