import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import type { Me } from "@tomotabi/contracts";
import { ApiRequestError, type ApiFailure } from "@/shared/api/api-failure";
import { getMe } from "../api/me-api";

/** ログイン中の人の情報のキャッシュのキー。401を受けたときにも消す（query-client）。 */
export const ME_QUERY_KEY = ["me"] as const;

/** 401と503は画面の出し分けに使うため、他の失敗と区別する。 */
export type MeState =
  | { status: "loading" }
  | { status: "ready"; me: Me }
  | { status: "unauthenticated" }
  | { status: "unavailable" }
  | { status: "error" };

function toState(failure: ApiFailure): MeState {
  if (failure.kind === "http" && failure.status === 401) {
    return { status: "unauthenticated" };
  }
  if (failure.kind === "http" && failure.status === 503) {
    return { status: "unavailable" };
  }
  return { status: "error" };
}

/**
 * ログイン中の人の情報。画面を移るたびに取り直さず、一度取ったものを使い回す
 * （設計書 screen-speed のSS-05）。ログアウトのときは`queryClient.clear()`と`clear`で消し、
 * どこかの取得で401を受けたときもキャッシュを消す（`createQueryClient`）。
 */
export function useMe() {
  const queryClient = useQueryClient();
  const [cleared, setCleared] = useState(false);
  const query = useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: async (): Promise<Me> => {
      const result = await getMe();
      if (result.isErr()) {
        throw new ApiRequestError(result.error);
      }
      return result.value;
    },
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
    enabled: !cleared,
  });

  const { refetch } = query;
  const reload = useCallback(async () => {
    setCleared(false);
    await refetch();
  }, [refetch]);

  const clear = useCallback(() => {
    setCleared(true);
    queryClient.removeQueries({ queryKey: ME_QUERY_KEY });
  }, [queryClient]);

  let state: MeState;
  if (cleared || query.isPending) {
    state = { status: "loading" };
  } else if (query.isError) {
    state =
      query.error instanceof ApiRequestError
        ? toState(query.error.failure)
        : { status: "error" };
  } else {
    state = { status: "ready", me: query.data };
  }

  return { state, reload, clear };
}
