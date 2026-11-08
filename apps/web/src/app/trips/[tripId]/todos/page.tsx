import { notFound } from "next/navigation";
import { isUuidString } from "@/shared/lib/uuid";
import { TodosRoute } from "./todos-route";

/** 画面の部品をCDNから配るため、IDは前もって決めない（設計書 screen-speed のSS-06）。 */
export function generateStaticParams(): { tripId: string }[] {
  return [];
}

export default async function Page({
  params,
}: {
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await params;
  if (!isUuidString(tripId)) {
    notFound();
  }
  return <TodosRoute tripId={tripId} />;
}
