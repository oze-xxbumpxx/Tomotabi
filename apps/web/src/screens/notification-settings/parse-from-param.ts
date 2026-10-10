import { isUuidString } from "@/shared/lib/uuid";

/**
 * `/settings/notifications?from=`。`from`は許した旅行の中の経路
 * （`/trips/{UUID}/...`）だけ受け付け、それ以外は戻る先を旅行一覧にする
 * （設計書「セキュリティ」）。戻る先は取り出したtripIdから
 * `/trips/{id}/home`に組み立て直す（fromの残りの部分は使わない）。
 */
export function parseFromParam(from: string | null): {
  backHref: string;
  tripId: string | null;
} {
  const fallback = { backHref: "/trips", tripId: null };
  if (from === null) {
    return fallback;
  }
  const match = /^\/trips\/([^/]+)\//.exec(from);
  if (match === null || !isUuidString(match[1])) {
    return fallback;
  }
  const tripId = match[1];
  return { backHref: `/trips/${tripId}/home`, tripId };
}
