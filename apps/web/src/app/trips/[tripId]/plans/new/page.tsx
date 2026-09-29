import { notFound } from "next/navigation";
import { PlanFormScreen } from "@/screens/plan-form/plan-form-screen";
import { isUuidString } from "@/shared/lib/uuid";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ tripId: string }>;
  searchParams: Promise<{ date?: string | string[] }>;
}) {
  const { tripId } = await params;
  if (!isUuidString(tripId)) {
    notFound();
  }
  const { date: raw } = await searchParams;
  const date =
    typeof raw === "string" && raw !== ""
      ? raw
      : Array.isArray(raw) && typeof raw[0] === "string" && raw[0] !== ""
        ? raw[0]
        : null;
  return <PlanFormScreen mode="new" tripId={tripId} date={date} />;
}
