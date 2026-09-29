/**
 * 前回開いた旅行を利用者ごとに localStorage へ保存する（F-23）。
 * 値は tripId だけで、認証情報は入れない。localStorage が使えない・
 * 壊れていても、読み書きの失敗で画面の動作を止めない（try/catch で飲み込む）。
 * サーバー描画で window を触らないよう、呼び出しは effect 以降に限る。
 */

const KEY_PREFIX = "tomotabi:selected-trip:";

function keyFor(userId: string): string {
  return `${KEY_PREFIX}${userId}`;
}

export function loadSelectedTripId(userId: string): string | null {
  try {
    const value = window.localStorage.getItem(keyFor(userId));
    return value === null || value === "" ? null : value;
  } catch {
    return null;
  }
}

export function saveSelectedTripId(userId: string, tripId: string): void {
  try {
    window.localStorage.setItem(keyFor(userId), tripId);
  } catch {
    // 保存できなくても画面の動作は止めない。
  }
}

export function clearSelectedTripId(userId: string): void {
  try {
    window.localStorage.removeItem(keyFor(userId));
  } catch {
    // 消せなくても画面の動作は止めない。
  }
}
