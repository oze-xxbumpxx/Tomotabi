import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Loading } from "@/shared/ui/state/loading";
import { isUuidString } from "@/shared/lib/uuid";
import { PlanDetailRoute } from "./plan-detail-route";

/** 画面の部品をCDNから配るため、IDは前もって決めない（設計書 screen-speed のSS-06）。 */
export function generateStaticParams(): { tripId: string; planId: string }[] {
  return [];
}

export default async function Page({
  params,
}: {
  params: Promise<{ tripId: string; planId: string }>;
}) {
  const { tripId, planId } = await params;
  if (!isUuidString(tripId) || !isUuidString(planId)) {
    notFound();
  }
  // useSearchParams()を使う部品はSuspenseで包む（包まないとページ全体がブラウザでの組み立てになる）。
  return (
    <Suspense fallback={<main><Loading /></main>}>
      <PlanDetailRoute tripId={tripId} planId={planId} />
    </Suspense>
  );
}
