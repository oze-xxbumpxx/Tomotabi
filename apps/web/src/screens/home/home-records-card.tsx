"use client";

import {
  CalendarCheck,
  CheckCircle,
  Prohibit,
  Receipt,
} from "@phosphor-icons/react";
import Link from "next/link";
import type { Me, Participant } from "@tomotabi/contracts";
import {
  displayNameOf,
  recordTitleOf,
  recordVerbOf,
  recordVoided,
  type HomeRecentRecords,
  type TimelineItem,
} from "@/features/trips";
import { splitLabelOf } from "@/features/settlement";
import { tokyoTimeOf } from "@/shared/lib/local-date";
import { formatYenDigits, yenFromDecimalString } from "@/shared/lib/yen";
import { FetchFailed } from "@/shared/ui/state/fetch-failed";

function recordIcon(item: TimelineItem) {
  switch (item.kind) {
    case "payment":
      return { Icon: Receipt, className: "home-rec-icon home-rec-icon-pay" };
    case "achievement":
      return {
        Icon: CheckCircle,
        className: "home-rec-icon home-rec-icon-done",
      };
    case "booking":
      return {
        Icon: CalendarCheck,
        className: "home-rec-icon home-rec-icon-booked",
      };
    default:
      return {
        Icon: Prohibit,
        className: "home-rec-icon home-rec-icon-cancel",
      };
  }
}

/** 記録の行の行き先。達成・予約はその予定、支払いは支払いの詳細。 */
function recordHref(tripId: string, item: TimelineItem): string {
  if (item.kind === "payment" || item.kind === "payment_cancellation") {
    return `/trips/${tripId}/payments/${item.id}`;
  }
  if (item.planId === null) {
    return `/trips/${tripId}/records`;
  }
  return `/trips/${tripId}/plans/${item.planId}?from=home`;
}

function recordAmount(item: TimelineItem): string | null {
  if (item.kind !== "payment" || !("amountYen" in item.detail)) {
    return null;
  }
  const yen = yenFromDecimalString(item.detail.amountYen);
  return yen === null ? null : `${formatYenDigits(yen)} 円`;
}

function recordMeta(
  item: TimelineItem,
  actor: string,
  participants: Participant[] | null,
): string {
  const base = `${tokyoTimeOf(new Date(item.createdAt))} · ${actor} が${recordVerbOf(item)}`;
  if (item.kind === "payment" && "allocations" in item.detail) {
    return `${base} · ${splitLabelOf(item.detail, participants ?? [])}`;
  }
  return base;
}

/**
 * ホームの最近の記録の欄（v3のrecentカード。最大3件はAPIの並びのまま）。
 * - 元の記録が取り消されている行は取消線と「取り消し済み」（F-24）
 * - 取り消しの行は「〇〇を取り消し」（F-20）
 * - 0件は「記録はまだありません」。欄の失敗はこの欄だけ
 *   「取得できませんでした」（F-48）
 */
export function HomeRecordsCard({
  tripId,
  section,
  participants,
  me,
  planNameOf,
  paymentLabelOf,
  onRetry,
}: {
  tripId: string;
  section: HomeRecentRecords;
  participants: Participant[] | null;
  me: Me | null;
  /** 予定IDから予定名（見つからないときはnull）。 */
  planNameOf: (planId: string | null) => string | null;
  /** 支払いIDから用途（見つからないときはnull）。 */
  paymentLabelOf: (paymentId: string) => string | null;
  onRetry: () => void;
}) {
  const items = section.status === "ok" ? section.data : null;

  return (
    <section className="home-card">
      <header className="home-card-head">
        <h2 className="home-card-title">最近の記録</h2>
        {items !== null && items.length > 0 && (
          <Link className="home-card-link" href={`/trips/${tripId}/records`}>
            記録一覧へ
          </Link>
        )}
      </header>
      {section.status === "unavailable" ? (
        <div className="home-card-body">
          <FetchFailed onRetry={onRetry} />
        </div>
      ) : items === null || items.length === 0 ? (
        <p className="home-empty-text home-empty-solo">
          記録はまだありません
        </p>
      ) : (
        <ul className="home-rec-items">
          {items.map((item) => {
            const { Icon, className } = recordIcon(item);
            const voided = recordVoided(item);
            const actor = displayNameOf(item.actorId, participants, me);
            const title = recordTitleOf(item, planNameOf, paymentLabelOf);
            const amount = recordAmount(item);
            return (
              <li key={`${item.kind}:${item.id}`}>
                <Link className="home-rec-row" href={recordHref(tripId, item)}>
                  <span className={className} aria-hidden="true">
                    <Icon
                      size={18}
                      weight={
                        item.kind === "achievement" ||
                        item.kind === "booking"
                          ? "fill"
                          : "regular"
                      }
                    />
                  </span>
                  <span className="home-rec-main">
                    <span
                      className={
                        voided
                          ? "home-rec-name home-rec-name-voided"
                          : "home-rec-name"
                      }
                    >
                      {title}
                    </span>
                    <span className="home-rec-meta tabular-nums">
                      {recordMeta(item, actor, participants)}
                    </span>
                  </span>
                  <span className="home-rec-side">
                    {amount !== null && (
                      <span
                        className={
                          voided
                            ? "home-rec-amount home-rec-name-voided"
                            : "home-rec-amount"
                        }
                      >
                        {amount}
                      </span>
                    )}
                    {voided && (
                      <span className="home-rec-voided-badge">取り消し済み</span>
                    )}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
