/**
 * cause チェーンを辿る深さの上限（循環する cause でも打ち切る）。
 */
const MAX_CAUSE_DEPTH = 8;

/**
 * `error` とその `cause` を最大 `MAX_CAUSE_DEPTH` 個まで辿り、`predicate` が
 * 真を返すノードがあれば true。drizzle は pg のエラーを DrizzleQueryError の
 * cause に包んで投げるため、SQLSTATE・errno はチェーンの中にある。
 * 循環する cause でも上限で打ち切る。オブジェクトでない値が途中に現れたら
 * そこで打ち切る。
 */
export function someInCauseChain(
  error: unknown,
  predicate: (node: object) => boolean,
): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
    if (typeof current !== "object" || current === null) {
      return false;
    }
    if (predicate(current)) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
