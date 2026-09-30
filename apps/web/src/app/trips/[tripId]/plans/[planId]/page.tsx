import { notFound } from "next/navigation";
import { PlanDetailScreen } from "@/screens/plan-detail/plan-detail-screen";
import { isUuidString } from "@/shared/lib/uuid";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ tripId: string; planId: string }>;
  searchParams: Promise<{ from?: string | string[] }>;
}) {
  const { tripId, planId } = await params;
  if (!isUuidString(tripId) || !isUuidString(planId)) {
    notFound();
  }
  const { from: raw } = await searchParams;
  const from =
    typeof raw === "string" && raw !== ""
      ? raw
      : Array.isArray(raw) && typeof raw[0] === "string" && raw[0] !== ""
        ? raw[0]
        : null;
  return <PlanDetailScreen tripId={tripId} planId={planId} from={from} />;
}
