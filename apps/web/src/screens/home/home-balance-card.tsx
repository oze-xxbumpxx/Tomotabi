"use client";

import {
  ArrowsLeftRight,
  Warning,
} from "@phosphor-icons/react";
import Link from "next/link";
import type { Me, Participant } from "@tomotabi/contracts";
import {
  displayNameOf,
  type HomeBalance,
} from "@/features/trips";
import { formatYenDigits, yenFromDecimalString } from "@/shared/lib/yen";

/**
 * ホームの精算の欄（v3のsettleカード）。
 * - 対象0件: 「現在、精算する対象はありません」（リンクは出さない）
 * - 対象ありで0円: 「受け渡しは不要です」と未処理の件数（「精算へ」）
 * - 受け渡しあり: 「A から B へ」と金額と対象の件数（「精算へ」）
 * - 欄の取得失敗: 「精算額を取得できませんでした」。0円にしない（F-48）
 */
export function HomeBalanceCard({
  tripId,
  section,
  participants,
  me,
  onRetry,
}: {
  tripId: string;
  section: HomeBalance;
  participants: Participant[] | null;
  me: Me | null;
  onRetry: () => void;
}) {
  if (section.status === "unavailable") {
    return (
      <section className="home-settle">
        <span className="home-settle-icon" aria-hidden="true">
          <ArrowsLeftRight size={22} />
        </span>
        <span className="home-settle-main">
          <span className="home-settle-error">
            <Warning size={14} weight="bold" aria-hidden="true" />
            精算額を取得できませんでした
          </span>
          <span className="home-settle-unknown">— — 円</span>
        </span>
        <button type="button" className="home-settle-retry" onClick={onRetry}>
          再試行
        </button>
      </section>
    );
  }

  const { transfer, targetCount } = section.data;
  const settlement = `/trips/${tripId}/settlement`;

  if (targetCount === 0) {
    return (
      <section className="home-settle">
        <span className="home-settle-icon" aria-hidden="true">
          <ArrowsLeftRight size={22} />
        </span>
        <span className="home-settle-main">
          <span className="home-settle-label">精算</span>
          <span className="home-settle-text">
            現在、精算する対象はありません
          </span>
        </span>
      </section>
    );
  }

  if (!transfer.requiresTransfer) {
    return (
      <section className="home-settle">
        <span className="home-settle-icon" aria-hidden="true">
          <ArrowsLeftRight size={22} />
        </span>
        <span className="home-settle-main">
          <span className="home-settle-text">受け渡しは不要です</span>
          <span className="home-settle-label">
            {`未処理の対象が ${targetCount} 件あります`}
          </span>
        </span>
        <Link className="home-card-link" href={settlement}>
          精算へ
        </Link>
      </section>
    );
  }

  const amount = yenFromDecimalString(transfer.amountYen);
  const fromName =
    transfer.fromUserId === null
      ? "相手"
      : displayNameOf(transfer.fromUserId, participants, me);
  const toName =
    transfer.toUserId === null
      ? "相手"
      : displayNameOf(transfer.toUserId, participants, me);

  return (
    <section className="home-settle">
      <span className="home-settle-icon" aria-hidden="true">
        <ArrowsLeftRight size={22} />
      </span>
      <span className="home-settle-main">
        <span className="home-settle-label">
          <b>{fromName}</b> から <b>{toName}</b> へ
        </span>
        <span className="home-settle-amount tabular-nums">
          {amount === null ? "— —" : formatYenDigits(amount)}
          <span className="home-settle-yen">円</span>
        </span>
        <span className="home-settle-label tabular-nums">
          {`対象 ${targetCount} 件`}
        </span>
      </span>
      <Link className="home-card-link" href={settlement}>
        精算へ
      </Link>
    </section>
  );
}
