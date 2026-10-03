import { useCallback, useState } from "react";
import { authClient } from "@/shared/auth/auth-client";
import {
  clearPendingRequestsForUser,
  listPendingRequestsForUser,
} from "@/shared/browser/pending-requests";
import { clearSelectedTripId } from "@/shared/browser/selected-trip-store";

/**
 * サインアウトを実行する。成功したときだけtrueを返す。
 * 成功時にはその利用者の「前回の旅行」の保存値と
 * 保留中の要求（IndexedDB）を消す（F-54）。
 * userIdが取れないときは保存値を消さずにサインアウトだけ行う
 * （次の入口で403ならそのときに消える）。
 * /sign-inへの遷移は呼び出し側（画面）が行う。
 */
export function useSignOut() {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
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
    async (userId: string | null): Promise<boolean> => {
      setPending(true);
      setFailed(false);
      try {
        const { error } = await authClient.signOut();
        setPending(false);
        if (error !== null) {
          setFailed(true);
          return false;
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
        return true;
      } catch {
        setPending(false);
        setFailed(true);
        return false;
      }
    },
    [],
  );

  return { signOut, checkPendingRequests, hasPendingRequests, pending, failed };
}
