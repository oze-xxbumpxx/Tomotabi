import { isUuidString } from "@/shared/lib/uuid";

/**
 * `/settings/notifications?from=`。`from`は許した旅行の中の経路
 * （`/trips/{UUID}/...`）だけ受け付け、それ以外は戻る先を旅行一覧にする
 * （設計書「セキュリティ」）。
 */
export function parseFromParam(from: string | undefined): {
  backHref: string;
  tripId: string | null;
} {
  const fallback = { backHref: "/trips", tripId: null };
  if (from === undefined) {
    return fallback;
  }
  const match = /^\/trips\/([^/]+)\//.exec(from);
  if (match === null || !isUuidString(match[1])) {
    return fallback;
  }
  return { backHref: from, tripId: match[1] };
}
