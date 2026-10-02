import { ArrowRight } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import type {
  Participant,
  Transfer,
} from "../api/settlement-api";
import { formatYen } from "@/shared/lib/yen";
import { slotOf, transferDirectionOf } from "../model/breakdown";
import { PersonAvatar } from "./person-avatar";

/**
 * 残額のカード（v3 の「精算」14・14f・14g）。
 * 対象 0 件 → 「現在、精算する対象はありません」。
 * 対象あり・0 円 → 「受け渡しは不要です」と未処理の件数。
 * 非 0 円 → 向き・金額・対象の件数。
 * 主操作（確認の作成）は呼び出し側が `action` として渡す。
 */
export function TransferCard({
  participants,
  transfer,
  targetCount,
  action,
}: {
  participants: Participant[];
  transfer: Transfer;
  targetCount: number;
  action?: ReactNode;
}) {
  const direction = transferDirectionOf(transfer, participants);

  if (targetCount === 0) {
    return (
      <section className="settle-card">
        <p className="settle-empty-title">現在、精算する対象はありません</p>
        <p className="settle-empty-body">
          支払いを記録すると、ここに受け渡しの額が出ます。
        </p>
      </section>
    );
  }

  if (direction === null) {
    return (
      <section className="settle-card">
        <p className="settle-count tabular-nums">{`対象 ${targetCount} 件`}</p>
        <p className="settle-amount tabular-nums">0 円</p>
        <p className="settle-zero-title">受け渡しは不要です</p>
        <p className="settle-zero-body">
          {`未処理の対象が ${targetCount} 件あります`}
        </p>
        {action}
      </section>
    );
  }

  const from = participants.find(
    (participant) => participant.userId === transfer.fromUserId,
  );
  const to = participants.find(
    (participant) => participant.userId === transfer.toUserId,
  );

  return (
    <section className="settle-card">
      <p className="settle-count tabular-nums">{`対象 ${targetCount} 件`}</p>
      <div className="settle-transfer">
        <div className="settle-person">
          <PersonAvatar
            name={direction.fromName}
            slot={from !== undefined ? slotOf(participants, from.userId) : null}
          />
          <span className="settle-person-name">{direction.fromName}</span>
          <span className="settle-person-role">から</span>
        </div>
        <ArrowRight
          size={20}
          weight="bold"
          className="settle-arrow"
          aria-hidden="true"
        />
        <div className="settle-person">
          <PersonAvatar
            name={direction.toName}
            slot={to !== undefined ? slotOf(participants, to.userId) : null}
          />
          <span className="settle-person-name">{direction.toName}</span>
          <span className="settle-person-role">へ</span>
        </div>
      </div>
      <p className="settle-amount tabular-nums">
        {formatYen(direction.amount)}
      </p>
      {action}
    </section>
  );
}
