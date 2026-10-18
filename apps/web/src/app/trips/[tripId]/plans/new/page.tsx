import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Loading } from "@/shared/ui/state/loading";
import { isUuidString } from "@/shared/lib/uuid";
import { PlanNewRoute } from "./plan-new-route";

/** 画面の部品をCDNから配るため、IDは前もって決めない（設計書 screen-speed のSS-06）。 */
export function generateStaticParams(): { tripId: string }[] {
  return [];
}

export default async function Page({
  params,
}: {
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await params;
  if (!isUuidString(tripId)) {
    notFound();
  }
  // useSearchParams()を使う部品はSuspenseで包む（包まないとページ全体がブラウザでの組み立てになる）。
  return (
    <Suspense fallback={<main><Loading /></main>}>
      <PlanNewRoute tripId={tripId} />
    </Suspense>
  );
}
