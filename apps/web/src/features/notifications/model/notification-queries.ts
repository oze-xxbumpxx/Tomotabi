import { useQuery } from "@tanstack/react-query";
import {
  fetchPushConfig,
  fetchPushSubscriptions,
} from "../api/notifications-api";

export const pushConfigQueryKey = ["push-config"] as const;
export const pushSubscriptionsQueryKey = ["push-subscriptions"] as const;

/** GET /api/me/push-config。503（鍵の設定の崩れ）も失敗として受け取る。 */
export function usePushConfig(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: pushConfigQueryKey,
    enabled: options?.enabled ?? true,
    queryFn: () =>
      fetchPushConfig().match(
        (config) => config,
        (failure) => {
          throw failure;
        },
      ),
    retry: false,
  });
}

/** GET /api/me/push-subscriptions。自分の購読の一覧。 */
export function usePushSubscriptions(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: pushSubscriptionsQueryKey,
    enabled: options?.enabled ?? true,
    queryFn: () =>
      fetchPushSubscriptions().match(
        (result) => result.items,
        (failure) => {
          throw failure;
        },
      ),
    retry: false,
  });
}
