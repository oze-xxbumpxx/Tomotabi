import { notFound } from "next/navigation";
import { PaymentDetailScreen } from "@/screens/payment-detail/payment-detail-screen";
import { isUuidString } from "@/shared/lib/uuid";

/**
 * 支払いの詳細（/trips/{tripId}/payments/{paymentId}）。
 * 記録の一覧の支払いの行・支払いを取り消した行から遷移する。
 */
export default async function PaymentPage({
  params,
}: {
  params: Promise<{ tripId: string; paymentId: string }>;
}) {
  const { tripId, paymentId } = await params;
  if (!isUuidString(tripId) || !isUuidString(paymentId)) {
    notFound();
  }
  return <PaymentDetailScreen tripId={tripId} paymentId={paymentId} />;
}
