/**
 * 「今のendpointに対応する購読のID」を利用者ごとにlocalStorageへ覚える
 * （F-09。キーは利用者のIDを含める）。値は購読のIDだけで、認証情報は入れない。
 * 読めなければ覚えていないものとして扱う。書き込みの失敗で画面の動作は止めない。
 * サーバー描画でwindowを触らないよう、呼び出しはeffect以降に限る。
 *
 * 利用者の切り替え（F-10）では、別の利用者の記憶が残っているか調べるため
 * キーの持ち主（利用者ID）を列挙する。
 */

const SUBSCRIPTION_KEY_PREFIX = "tomotabi:push-subscription:";
const GUIDE_DISMISSED_KEY_PREFIX = "tomotabi:push-guide-dismissed:";

function subscriptionKeyFor(userId: string): string {
  return `${SUBSCRIPTION_KEY_PREFIX}${userId}`;
}

export function loadRememberedSubscriptionId(userId: string): string | null {
  try {
    const value = window.localStorage.getItem(subscriptionKeyFor(userId));
    return value === null || value === "" ? null : value;
  } catch {
    return null;
  }
}

export function saveRememberedSubscriptionId(
  userId: string,
  subscriptionId: string,
): void {
  try {
    window.localStorage.setItem(subscriptionKeyFor(userId), subscriptionId);
  } catch {
    // 覚えられなくても登録は続ける。
  }
}

function clearRememberedSubscriptionId(userId: string): void {
  try {
    window.localStorage.removeItem(subscriptionKeyFor(userId));
  } catch {
    // 消せなくても画面の動作は止めない。
  }
}

/**
 * 端末に覚えられた購読IDの持ち主（利用者ID）を返す。
 * 前の利用者がログアウトを通らずに切り替わったかを調べるのに使う。
 * localStorageが読めなければ空配列。
 */
export function listRememberedOwnerIds(): string[] {
  try {
    const ownerIds: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key !== null && key.startsWith(SUBSCRIPTION_KEY_PREFIX)) {
        ownerIds.push(key.slice(SUBSCRIPTION_KEY_PREFIX.length));
      }
    }
    return ownerIds;
  } catch {
    return [];
  }
}

/**
 * 今の利用者以外の記憶を消す。前の人の購読をブラウザで解除したあとに呼ぶ
 * （解除した宛先は配信サービスで使えないので、記憶は古い値になる）。
 */
export function clearRememberedSubscriptionIdsExcept(userId: string): void {
  for (const ownerId of listRememberedOwnerIds()) {
    if (ownerId !== userId) {
      clearRememberedSubscriptionId(ownerId);
    }
  }
}

/**
 * ホームの案内のカードを閉じたこと（「この端末・この人で閉じた」）を覚える。
 * 読めなければ閉じていないものとして扱い、カードを出す（F-18）。
 */
export function loadGuideDismissed(userId: string): boolean {
  try {
    return (
      window.localStorage.getItem(`${GUIDE_DISMISSED_KEY_PREFIX}${userId}`) !==
      null
    );
  } catch {
    return false;
  }
}

export function saveGuideDismissed(userId: string): void {
  try {
    window.localStorage.setItem(`${GUIDE_DISMISSED_KEY_PREFIX}${userId}`, "1");
  } catch {
    // 覚えられなくても閉じる動作は行う（次に開いたときに出るだけ）。
  }
}

export { clearRememberedSubscriptionId };
