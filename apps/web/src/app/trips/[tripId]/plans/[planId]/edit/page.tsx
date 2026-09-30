import { notFound } from "next/navigation";
import { PlanFormScreen } from "@/screens/plan-form/plan-form-screen";
import { isUuidString } from "@/shared/lib/uuid";

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
