import { useQuery } from "@tanstack/react-query";
import { ApiRequestError } from "@/shared/api/api-failure";
import { getPlan } from "../api/plans-api";

/**
 * 予定のキーは`["plan", tripId, planId]`（設計書「取得状態」）。
 */
export const planQueryKey = (tripId: string, planId: string) =>
  ["plan", tripId, planId] as const;

/** 予定1件（GET /trips/{tripId}/plans/{planId}）。詳細と編集のデータ元。 */
export function usePlan(
  tripId: string,
  planId: string,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: planQueryKey(tripId, planId),
    enabled: options?.enabled ?? true,
    queryFn: () =>
      getPlan(tripId, planId).match(
        (plan) => plan,
        (failure) => {
          throw new ApiRequestError(failure);
        },
      ),
  });
}
