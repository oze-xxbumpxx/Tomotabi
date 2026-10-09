import { NotificationSettingsScreen } from "@/screens/notification-settings/notification-settings-screen";
import { parseFromParam } from "@/screens/notification-settings/parse-from-param";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ from?: string | string[] }>;
}) {
  const { from } = await searchParams;
  const raw = typeof from === "string" ? from : undefined;
  const { backHref, tripId } = parseFromParam(raw);
  return <NotificationSettingsScreen backHref={backHref} tripId={tripId} />;
}
