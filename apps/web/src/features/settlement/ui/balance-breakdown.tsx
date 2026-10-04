import {
  ArrowBendDownRight,
  ArrowDownLeft,
  ArrowUpRight,
} from "@phosphor-icons/react";
import type {
  Participant,
  TargetItem,
} from "../api/settlement-api";
import { formatYen } from "@/shared/lib/yen";
import { nameOf, personTotalsOf, slotOf } from "../model/breakdown";
import { PersonAvatar } from "./person-avatar";

/**
 * 内訳のカード（v3の14b）。二人それぞれに「支払った額・負担額・差」を
 * 並べ、差が正なら「受け取る」、負なら「渡す」のバッジを付ける。
 * 戻し（REVERSAL）の明細は額を引く側として数える。
 */
export function BalanceBreakdown({
  participants,
  items,
}: {
  participants: Participant[];
  items: TargetItem[];
}) {
  const totals = participants.map((participant) =>
    personTotalsOf(items, participant.userId),
  );
  const paidSum = totals.reduce((sum, t) => sum + t.paid, 0n);
  const burdenSum = totals.reduce((sum, t) => sum + t.burden, 0n);

  return (
    <section className="settle-card">
      <h2 className="settle-card-title">内訳</h2>
      <div className="settle-people">
        {participants.map((participant, index) => {
          const total = totals[index];
          const other = participants.find(
            (candidate) => candidate.userId !== participant.userId,
          );
          const sentence =
            total === undefined || other === undefined
              ? null
              : total.diff > 0n
                ? `支払った額のほうが多いので、${nameOf(participants, other.userId)} から受け取ります`
                : total.diff < 0n
                  ? `負担額のほうが多いので、${nameOf(participants, other.userId)} に渡します`
                  : "支払った額と負担額は同じです";
          return (
            <div className="settle-person-block" key={participant.userId}>
              <div className="settle-person-head">
                <PersonAvatar
                  name={participant.displayName}
                  slot={slotOf(participants, participant.userId)}
                />
                <span className="settle-person-name">
                  {participant.displayName}
                </span>
                {total !== undefined && total.diff !== 0n && (
                  <span
                    className={
                      total.diff > 0n
                        ? "settle-badge settle-badge-receive"
                        : "settle-badge settle-badge-pay"
                    }
                  >
                    {total.diff > 0n ? (
                      <ArrowDownLeft
                        size={13}
                        weight="bold"
                        aria-hidden="true"
                      />
                    ) : (
                      <ArrowUpRight
                        size={13}
                        weight="bold"
                        aria-hidden="true"
                      />
                    )}
                    {total.diff > 0n
                      ? `受け取る ${formatYen(total.diff)}`
                      : `渡す ${formatYen(-total.diff)}`}
                  </span>
                )}
              </div>
              {total !== undefined && (
                <>
                  <div className="settle-tiles">
                    <div className="settle-tile">
                      <span className="settle-tile-label">支払った額</span>
                      <span className="settle-tile-value tabular-nums">
                        {formatYen(total.paid)}
                      </span>
                    </div>
                    <div className="settle-tile">
                      <span className="settle-tile-label">負担額</span>
                      <span className="settle-tile-value tabular-nums">
                        {formatYen(total.burden)}
                      </span>
                    </div>
                    <div className="settle-tile">
                      <span className="settle-tile-label">差</span>
                      <span className="settle-tile-value tabular-nums">
                        {formatYen(
                          total.diff < 0n ? -total.diff : total.diff,
                        )}
                      </span>
                    </div>
                  </div>
                  <p className="settle-breakdown-sentence">
                    <ArrowBendDownRight
                      size={14}
                      className="settle-breakdown-sentence-icon"
                      aria-hidden="true"
                    />
                    {sentence}
                  </p>
                </>
              )}
            </div>
          );
        })}
      </div>
      <p className="settle-breakdown-footer tabular-nums">
        {`支払いの合計 ${formatYen(paidSum)} ＝ 二人の負担額の合計 ${formatYen(burdenSum)}`}
      </p>
    </section>
  );
}
