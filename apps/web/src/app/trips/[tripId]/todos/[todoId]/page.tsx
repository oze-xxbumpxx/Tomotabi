import { notFound } from "next/navigation";
import { isUuidString } from "@/shared/lib/uuid";
import { TodoDetailRoute } from "./todo-detail-route";

/** 画面の部品をCDNから配るため、IDは前もって決めない（設計書 screen-speed のSS-06）。 */
export function generateStaticParams(): { tripId: string; todoId: string }[] {
  return [];
}

export default async function Page({
  params,
}: {
  params: Promise<{ tripId: string; todoId: string }>;
}) {
  const { tripId, todoId } = await params;
  if (!isUuidString(tripId) || !isUuidString(todoId)) {
    notFound();
  }
  return <TodoDetailRoute tripId={tripId} todoId={todoId} />;
}
