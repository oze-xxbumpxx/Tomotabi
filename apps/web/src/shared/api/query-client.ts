import { QueryClient } from "@tanstack/react-query";
import { ApiRequestError, isApiFailure } from "./api-failure";

function isNetworkFailure(error: unknown): boolean {
  if (error instanceof ApiRequestError) {
    return error.failure.kind === "network";
  }
  return isApiFailure(error) && error.kind === "network";
}

/**
 * QueryClientの既定値。再試行はGETのnetwork失敗の1回だけで、
 * httpの失敗（4xx・5xx）と応答の解釈失敗は再試行しない。
 * mutationは自動で再試行しない（同じ要求での確認は保存状態のhookが行う）。
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 0,
        refetchOnWindowFocus: true,
        retry: (failureCount, error) =>
          failureCount === 0 && isNetworkFailure(error),
      },
      mutations: {
        retry: false,
      },
    },
  });
}
