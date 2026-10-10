import { NotificationSettingsScreen } from "@/screens/notification-settings/notification-settings-screen";
import { parseFromParam } from "@/screens/notification-settings/parse-from-param";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ from?: string | string[] }>;
}) {
  const { from: raw } = await searchParams;
  const from =
    typeof raw === "string" && raw !== ""
      ? raw
      : Array.isArray(raw) && typeof raw[0] === "string" && raw[0] !== ""
        ? raw[0]
        : null;
  const { backHref, tripId } = parseFromParam(from);
  return <NotificationSettingsScreen backHref={backHref} tripId={tripId} />;
}
