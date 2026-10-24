import { ArrowBendDownRight } from "@phosphor-icons/react";
import type {
  Participant,
  TargetItem,
} from "../api/settlement-api";
import { formatYen } from "@/shared/lib/yen";
import { nameOf, personTotalsOf, slotOf } from "../model/breakdown";
import { PersonAvatar } from "./person-avatar";

/**
 * 内訳のカード（v3の14b）。誰が誰にいくら渡すかは上の結果のカードが出すので、
 * ここは閉じておき、開いたときだけ二人それぞれの「支払った額・負担額」と
 * その説明を出す（#250。差を二人分、同じ大きさで並べない）。
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
      <details className="settle-breakdown-details">
        <summary className="settle-card-title">内訳を見る</summary>
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
                  ? `支払った額のほうが ${formatYen(total.diff)} 多いので、${nameOf(participants, other.userId)} から受け取ります`
                  : total.diff < 0n
                    ? `負担額のほうが ${formatYen(-total.diff)} 多いので、${nameOf(participants, other.userId)} に渡します`
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
      </details>
    </section>
  );
}
