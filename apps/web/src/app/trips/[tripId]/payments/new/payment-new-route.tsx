"use client";

import { useSearchParams } from "next/navigation";
import { PaymentFormScreen } from "@/screens/payment-form/payment-form-screen";
import { parsePaymentNewQuery } from "../../route-query";

/** 支払いを記録（`?planId=&from=`）。問い合わせをブラウザで読み、画面に渡す（設計書 screen-speed のSS-06）。 */
export function PaymentNewRoute({ tripId }: { tripId: string }) {
  const query = parsePaymentNewQuery(useSearchParams());
  return (
    <PaymentFormScreen
      tripId={tripId}
      planId={query.planId}
      fromPaymentId={query.fromPaymentId}
    />
  );
}
