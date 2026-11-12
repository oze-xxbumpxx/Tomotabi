import type { QueryObserverResult } from "@tanstack/react-query";

/**
 * TanStack Queryの`refetch()`は、再取得に失敗しても例外を投げず、最後に
 * 成功した`data`を残した結果（`isRefetchError`）を返す。取り直した値を
 * 信用してよいかは`data`の有無ではなく`isSuccess`で見る。
 * 428（版が古い）のあとの「もう一度読み込む」で、再取得に失敗したのに
 * 古い内容で入力・版・拒否の状態を置き換えないために使う。
 */
export function refetchSucceeded<TData, TError>(
  result: QueryObserverResult<TData, TError>,
): result is QueryObserverResult<TData, TError> & { data: TData } {
  return result.isSuccess;
}
