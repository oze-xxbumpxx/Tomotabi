import type {
  Participant,
  Settlement,
} from "../api/settlement-api";
import { formatDateTime } from "@/shared/lib/local-date";
import { transferLabel } from "../model/breakdown";

/**
 * 精算の履歴（新しい順）。各行は記録の日時・向き・金額と、
 * 取り消し済みならその印を出す。0 円の精算は「受け渡し不要」と出す。
 */
export function SettlementHistory({
  settlements,
  participants,
}: {
  settlements: Settlement[];
  participants: Participant[];
}) {
  return (
    <section className="settle-card">
      <h2 className="settle-card-title">精算の履歴</h2>
      {settlements.length === 0 ? (
        <p className="settle-empty-body">精算の履歴はまだありません</p>
      ) : (
        <ul className="settle-rows">
          {settlements.map((settlement) => {
            const cancelled = settlement.cancellation !== null;
            return (
              <li className="settle-row-static" key={settlement.id}>
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
