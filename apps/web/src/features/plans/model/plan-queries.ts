import { useQueries, useQuery } from "@tanstack/react-query";
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

/**
 * 予定IDの一覧を予定名の対応表にする。ホーム・記録の一覧の
 * 「予定の名前」を持たない行が、行ごとの予定名を引くときに使う
 * （失敗した予定は対応表に入れず、呼び出し側の代替表示に任せる）。
 */
export function usePlanNames(
  tripId: string,
  planIds: readonly string[],
): Map<string, string> {
  return useQueries({
    queries: planIds.map((planId) => ({
      queryKey: planQueryKey(tripId, planId),
      queryFn: () =>
        getPlan(tripId, planId).match(
          (plan) => plan,
          (failure) => {
            throw new ApiRequestError(failure);
          },
        ),
    })),
    combine: (results) => {
      const names = new Map<string, string>();
      results.forEach((result, index) => {
        if (result.data !== undefined) {
          names.set(planIds[index] ?? "", result.data.name);
        }
      });
      return names;
    },
  });
}
