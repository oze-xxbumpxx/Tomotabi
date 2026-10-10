import { notFound } from "next/navigation";
import { SettlementScreen } from "@/screens/settlement/settlement-screen";
import { parseFocusSettlementId } from "@/screens/settlement/focus-settlement-id";
import { isUuidString } from "@/shared/lib/uuid";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ tripId: string }>;
  searchParams: Promise<{ settlementId?: string | string[] }>;
}) {
  const { tripId } = await params;
  if (!isUuidString(tripId)) {
    notFound();
  }
  // 通知から開いた精算の1件を目立たせる（F-52）。形が違えば無視する。
  const { settlementId } = await searchParams;
  const focusSettlementId = parseFocusSettlementId(settlementId ?? null);
  return (
    <SettlementScreen tripId={tripId} focusSettlementId={focusSettlementId} />
  );
}
