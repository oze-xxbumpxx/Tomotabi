import { notFound } from "next/navigation";
import { Suspense } from "react";
import { RecordsPageSkeleton } from "@/screens/records/records-skeleton";
import { isUuidString } from "@/shared/lib/uuid";
import { RecordsRoute } from "./records-route";

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
    <Suspense fallback={<RecordsPageSkeleton />}>
      <RecordsRoute tripId={tripId} />
    </Suspense>
  );
}
