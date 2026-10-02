import { notFound } from "next/navigation";
import { SettlementPreviewScreen } from "@/screens/settlement-preview/settlement-preview-screen";
import { isUuidString } from "@/shared/lib/uuid";

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
