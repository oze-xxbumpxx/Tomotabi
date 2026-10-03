import { useCallback, useEffect, useState } from "react";
import {
  deletePendingRequestsForOtherUsers,
  findPendingRequest,
  type PendingRequestRecord,
} from "./pending-requests";

/**
 * 再読み込み後の復帰の状態。`found`のときは呼び出し側が
 * 「保存されたか確認できません」と「同じ内容で確認する」を出す
 * （自動では送らない。送るのは本人の操作だけ）。
 * `unavailable`はIndexedDBが読めなかったとき、または読めたが
 * 形を確かめられず保留を消したとき（保存の送信も止める案内を出す）。
 */
export type PendingRequestCheck =
  | { status: "checking" }
  | { status: "none" }
  | { status: "found"; record: PendingRequestRecord }
  | { status: "unavailable" };

/**
 * 画面を開いたときに、同じ利用者・旅行・操作の保留をIndexedDBで探す。
 * `userId`がnullのあいだ（利用者がまだ分からない）は`checking`のままにし、
 * 別の利用者の保留を見せない。利用者が分かったら、先に他の利用者の保留を消す。
 */
export function usePendingRequestCheck(input: {
  userId: string | null;
  tripId: string;
  operation: string;
}): { check: PendingRequestCheck; reload: () => void } {
  const [check, setCheck] = useState<PendingRequestCheck>({
    status: "checking",
  });
  const [attempt, setAttempt] = useState(0);
  const { userId, tripId, operation } = input;

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    if (userId === null) {
      setCheck({ status: "checking" });
      return;
    }
    let cancelled = false;
    setCheck({ status: "checking" });
    const signedInUserId = userId;
    void (async () => {
      await deletePendingRequestsForOtherUsers(signedInUserId);
      return findPendingRequest({
        userId: signedInUserId,
        tripId,
        operation,
      });
    })().then(
      (lookup) => {
        if (cancelled) {
          return;
        }
        switch (lookup.status) {
          case "none":
            setCheck({ status: "none" });
            return;
          case "found":
            setCheck({ status: "found", record: lookup.record });
            return;
          case "invalid":
            setCheck({ status: "unavailable" });
            return;
        }
      },
      () => {
        if (!cancelled) {
          setCheck({ status: "unavailable" });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [userId, tripId, operation, attempt]);

  return { check, reload };
}
