import { notFound } from "next/navigation";
import { PaymentFormScreen } from "@/screens/payment-form/payment-form-screen";
import { isUuidString } from "@/shared/lib/uuid";

/**
 * 支払いを記録（/trips/{tripId}/payments/new?planId=）。
 * planId は UUID の形のときだけ渡す（形の合わない指定は無かったことにする）。
 */
export default async function PaymentNewPage({
  params,
  searchParams,
}: {
  params: Promise<{ tripId: string }>;
  searchParams: Promise<{ planId?: string | string[] }>;
}) {
  const { tripId } = await params;
  if (!isUuidString(tripId)) {
    notFound();
  }
  const raw = (await searchParams).planId;
  const planIdParam = Array.isArray(raw) ? raw[0] : raw;
  const planId =
    planIdParam !== undefined && isUuidString(planIdParam)
      ? planIdParam
      : null;
  return <PaymentFormScreen tripId={tripId} planId={planId} />;
}
