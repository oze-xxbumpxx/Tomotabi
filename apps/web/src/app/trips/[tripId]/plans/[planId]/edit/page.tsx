import { notFound } from "next/navigation";
import { PlanFormScreen } from "@/screens/plan-form/plan-form-screen";
import { isUuidString } from "@/shared/lib/uuid";

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
  return <PlanFormScreen mode="edit" tripId={tripId} planId={planId} />;
}
