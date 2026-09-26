import { useCallback, useState } from "react";
import { authClient } from "@/shared/auth/auth-client";

/**
 * サインアウトを実行する。成功したときだけ true を返す。
 * 画面状態の消去と /sign-in への遷移は呼び出し側（画面）が行う。
 */
export function useSignOut() {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  const signOut = useCallback(async (): Promise<boolean> => {
    setPending(true);
    setFailed(false);
    try {
      const { error } = await authClient.signOut();
      setPending(false);
      if (error !== null) {
        setFailed(true);
        return false;
      }
      return true;
    } catch {
      setPending(false);
      setFailed(true);
      return false;
    }
  }, []);

  return { signOut, pending, failed };
}
