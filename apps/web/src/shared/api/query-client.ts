import { QueryCache, QueryClient } from "@tanstack/react-query";
import { ApiRequestError, isApiFailure } from "./api-failure";

function isNetworkFailure(error: unknown): boolean {
  if (error instanceof ApiRequestError) {
    return error.failure.kind === "network";
  }
  return isApiFailure(error) && error.kind === "network";
}

function isUnauthorized(error: unknown): boolean {
  const failure = error instanceof ApiRequestError ? error.failure : isApiFailure(error) ? error : null;
  return failure !== null && failure.kind === "http" && failure.status === 401;
}

/**
 * QueryClientの既定値。再試行はGETのnetwork失敗の1回だけで、
 * httpの失敗（4xx・5xx）と応答の解釈失敗は再試行しない。
 * mutationは自動で再試行しない（同じ要求での確認は保存状態のhookが行う）。
 */
export function createQueryClient(): QueryClient {
  // 業務のデータの取得で401を受けたら、使い回しているログイン中の人の情報も消す
  // （設計書 screen-speed のSS-05。次に開く画面で取り直す）。
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        if (query.queryKey[0] === "me" || !isUnauthorized(error)) {
          return;
        }
        client.removeQueries({ queryKey: ["me"] });
      },
    }),
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
  return client;
}
