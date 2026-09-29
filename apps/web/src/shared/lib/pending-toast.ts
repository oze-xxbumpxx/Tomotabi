/**
 * 画面遷移をまたいで成功のトーストを 1 回だけ受け渡すための小さな受け皿。
 * 書き込み成功 → 別画面へ遷移 → 遷移先で取り出して表示、の順に使う。
 * 値はモジュール内に 1 件だけ残り、取り出すと消える。
 */

let pending: string | null = null;

export function setPendingToast(message: string): void {
  pending = message;
}

export function takePendingToast(): string | null {
  const message = pending;
  pending = null;
  return message;
}
