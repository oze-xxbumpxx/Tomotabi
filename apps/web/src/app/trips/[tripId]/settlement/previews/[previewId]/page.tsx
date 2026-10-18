import { notFound } from "next/navigation";
import { SettlementPreviewScreen } from "@/screens/settlement-preview/settlement-preview-screen";
import { isUuidString } from "@/shared/lib/uuid";

/** 画面の部品をCDNから配るため、IDは前もって決めない（設計書 screen-speed のSS-06）。 */
export function generateStaticParams(): { tripId: string; previewId: string }[] {
  return [];
}

export default async function Page({
  params,
}: {
  params: Promise<{ tripId: string; previewId: string }>;
}) {
  const { tripId, previewId } = await params;
  if (!isUuidString(tripId) || !isUuidString(previewId)) {
    notFound();
  }
  return <SettlementPreviewScreen tripId={tripId} previewId={previewId} />;
}
