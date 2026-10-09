import { useCallback, useState } from "react";
import { unsubscribeForSignOut } from "@/shared/push/unsubscribe-for-sign-out";
import { authClient } from "@/shared/auth/auth-client";
import {
  clearPendingRequestsForUser,
  listPendingRequestsForUser,
} from "@/shared/browser/pending-requests";
import { clearSelectedTripId } from "@/shared/browser/selected-trip-store";

/** サインアウトの失敗の種類。「通知を止められなかった」は文を変える（F-62）。 */
export type SignOutFailure = "generic" | "push-stop";

export type SignOutResult =
  | {
      ok: true;
      /**
       * 応答のX-Push-Stopped。falseなら通知を止められなかったので、
       * 移った先のログインの画面に案内を出す（F-65）。ヘッダーが無ければnull。
       */
      pushStopped: boolean | null;
    }
  | { ok: false };

/**
 * サインアウトを実行する。サインアウトの前にブラウザの購読を解除する
 * （失敗しても続ける）。応答が503 PUSH_STOP_FAILEDならログアウトせず
 * 「通知を止められませんでした」と出す（F-62）。
 * 成功したときだけ{ ok: true }を返す。
 * 成功時にはその利用者の「前回の旅行」の保存値と
 * 保留中の要求（IndexedDB）を消す（F-54）。
 * userIdが取れないときは保存値を消さずにサインアウトだけ行う
 * （次の入口で403ならそのときに消える）。
 * /sign-inへの遷移は呼び出し側（画面）が行う。
 */
export function useSignOut() {
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<SignOutFailure | null>(null);
  const [hasPendingRequests, setHasPendingRequests] = useState(false);

  /**
   * その利用者に結果不明の要求が残っているか調べる。
   * あれば画面はログアウトの前に「確認できていない保存があります」と
   * 出せる（ログアウト自体は止めない）。読めなくても止めない。
   */
  const checkPendingRequests = useCallback(
    async (userId: string | null): Promise<boolean> => {
      if (userId === null) {
        setHasPendingRequests(false);
        return false;
      }
      try {
        const has = (await listPendingRequestsForUser(userId)).length > 0;
        setHasPendingRequests(has);
        return has;
      } catch {
        setHasPendingRequests(false);
        return false;
      }
    },
    [],
  );

  const signOut = useCallback(
    async (userId: string | null): Promise<SignOutResult> => {
      setPending(true);
      setFailure(null);
      try {
        // 先にブラウザの購読を解除する。失敗しても続ける（F-63）。
        await unsubscribeForSignOut();

        let pushStoppedHeader: string | null = null;
        const { error } = await authClient.signOut({
          fetchOptions: {
            onResponse: (context) => {
              pushStoppedHeader =
                context.response.headers.get("x-push-stopped");
            },
          },
        });
        setPending(false);
        if (error !== null) {
          // 503は「通知を止める前処理か認証の基盤の失敗」（ログアウトはしていない）。
          setFailure(error.status === 503 ? "push-stop" : "generic");
          return { ok: false };
        }
        if (userId !== null) {
          clearSelectedTripId(userId);
          try {
            await clearPendingRequestsForUser(userId);
          } catch {
            // 端末の保存を消せなくてもログアウトは止めない。
          }
        }
        setHasPendingRequests(false);
        const pushStopped =
          pushStoppedHeader === null ? null : pushStoppedHeader === "true";
        return { ok: true, pushStopped };
      } catch {
        setPending(false);
        setFailure("generic");
        return { ok: false };
      }
    },
    [],
  );

  return {
    signOut,
    checkPendingRequests,
    hasPendingRequests,
    pending,
    failure,
    /** 後方互換のため残す（通知の失敗も含め、なんらかの失敗があればtrue）。 */
    failed: failure !== null,
  };
}
