"use client";

import { useSearchParams } from "next/navigation";
import { SettlementScreen } from "@/screens/settlement/settlement-screen";
import { parseSettlementQuery } from "../route-query";

/** 精算（`?settlementId=`）。問い合わせをブラウザで読み、画面に渡す（設計書 screen-speed のSS-06）。 */
export function SettlementRoute({ tripId }: { tripId: string }) {
  const query = parseSettlementQuery(useSearchParams());
  return (
    <SettlementScreen tripId={tripId} focusSettlementId={query.focusSettlementId} />
  );
}
