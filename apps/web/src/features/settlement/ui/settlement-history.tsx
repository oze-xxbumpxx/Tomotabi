import { useEffect, useRef } from "react";
import type {
  Participant,
  Settlement,
} from "../api/settlement-api";
import { formatDateTime } from "@/shared/lib/local-date";
import { transferLabel } from "../model/breakdown";

/**
 * 精算の履歴（新しい順）。各行は記録の日時・向き・金額と、
 * 取り消し済みならその印を出す。0円の精算は「受け渡し不要」と出す。
 * `focusSettlementId`（通知から開いた1件）が履歴にあれば、その行に
 * 枠を付けてスクロールする（F-52）。無ければふつうに出す。
 */
export function SettlementHistory({
  settlements,
  participants,
  focusSettlementId = null,
}: {
  settlements: Settlement[];
  participants: Participant[];
  focusSettlementId?: string | null;
}) {
  const focusRef = useRef<HTMLLIElement | null>(null);
  const hasFocus =
    focusSettlementId !== null &&
    settlements.some((settlement) => settlement.id === focusSettlementId);

  useEffect(() => {
    // 枠を付けた行が見える位置までスクロールする。
    focusRef.current?.scrollIntoView({ block: "center" });
  }, [focusSettlementId, hasFocus]);

  return (
    <section className="settle-card">
      <h2 className="settle-card-title">精算の履歴</h2>
      {settlements.length === 0 ? (
        <p className="settle-empty-body">精算の履歴はまだありません</p>
      ) : (
        <ul className="settle-rows">
          {settlements.map((settlement) => {
            const cancelled = settlement.cancellation !== null;
            const focused =
              hasFocus && settlement.id === focusSettlementId;
            return (
              <li
                className={
                  focused
                    ? "settle-row-static settle-row-focused"
                    : "settle-row-static"
                }
                key={settlement.id}
                ref={focused ? focusRef : null}
              >
                <span className="settle-row-main">
                  <span
                    className={
                      cancelled
                        ? "settle-row-title settle-row-title-cancelled"
                        : "settle-row-title"
                    }
                  >
                    {settlement.transfer.requiresTransfer
                      ? transferLabel(settlement.transfer, participants)
                      : "受け渡し不要として記録"}
                  </span>
                  <span className="settle-row-sub tabular-nums">
                    {formatDateTime(settlement.createdAt)}
                  </span>
                </span>
                {cancelled && (
                  <span className="settle-row-note">取り消し済み</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
