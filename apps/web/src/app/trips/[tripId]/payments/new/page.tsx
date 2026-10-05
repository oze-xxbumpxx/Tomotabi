import { notFound } from "next/navigation";
import { PaymentFormScreen } from "@/screens/payment-form/payment-form-screen";
import { isUuidString } from "@/shared/lib/uuid";

/**
 * 支払いを記録（/trips/{tripId}/payments/new?planId=）。
 * planIdはUUIDの形のときだけ渡す（形の合わない指定は無かったことにする）。
 */
export default async function PaymentNewPage({
  params,
  searchParams,
}: {
  params: Promise<{ tripId: string }>;
  searchParams: Promise<{
    planId?: string | string[];
    from?: string | string[];
  }>;
}) {
  const { tripId } = await params;
  if (!isUuidString(tripId)) {
    notFound();
  }
  const raw = await searchParams;
  const planIdParam = Array.isArray(raw.planId)
    ? raw.planId[0]
    : raw.planId;
  const planId =
    planIdParam !== undefined && isUuidString(planIdParam)
      ? planIdParam
      : null;
  // 「正しい内容で支払いを記録」の写す支払い（形の合わない指定は無し扱い）。
  const fromParam = Array.isArray(raw.from) ? raw.from[0] : raw.from;
  const fromPaymentId =
    fromParam !== undefined && isUuidString(fromParam)
      ? fromParam
      : null;
  return (
    <PaymentFormScreen
      tripId={tripId}
      planId={planId}
      fromPaymentId={fromPaymentId}
    />
  );
}
