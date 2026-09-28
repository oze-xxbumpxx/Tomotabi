import { useCallback, useState } from "react";
import { authClient } from "@/shared/auth/auth-client";
import { clearSelectedTripId } from "@/shared/browser/selected-trip-store";

/**
 * サインアウトを実行する。成功したときだけ true を返す。
 * 成功時にはその利用者の「前回の旅行」の保存値を消す（F-23）。
 * userId が取れないときは保存値を消さずにサインアウトだけ行う
 * （次の入口で 403 ならそのときに消える）。
 * /sign-in への遷移は呼び出し側（画面）が行う。
 */
export function useSignOut() {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

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
        }
        return true;
      } catch {
        setPending(false);
        setFailed(true);
        return false;
      }
    },
    [],
  );

  return { signOut, pending, failed };
}
