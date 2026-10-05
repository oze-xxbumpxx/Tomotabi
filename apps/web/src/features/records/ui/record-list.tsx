import Link from "next/link";
import type { ReactNode } from "react";
import {
  ArrowUUpLeft,
  CalendarCheck,
  CheckCircle,
  Receipt,
} from "@phosphor-icons/react";
import type { TimelineItem, TimelineItemKind } from "../api/records-api";
import {
  baseKindLabelOf,
  baseKindOf,
  dayKeyOf,
  eventOf,
  isVoided,
  paymentOf,
  shareNoteOfPayment,
  timeOfDay,
} from "../model/record-view";
import { formatLocalDate } from "@/shared/lib/local-date";
import { formatYen } from "@/shared/lib/yen";

/**
 * 記録の一覧（日ごとの見出しつき）。行の中身は種類で決める:
 * 支払いは名前・負担・金額、達成・予約は予定の名前、
 * 取り消しは「〇〇を取り消し」。元の記録が取り消されていれば
 * 線で消して「取り消し済み」を付ける（F-20・F-24）。
 * 予定・支払いの名前は呼び出し側が渡す解決（機能の外の取得は
 * screensが組み合わせる）で出す。
 */

/** 行に出す名前の解決（screenがusePlan / usePaymentで組み立てる）。 */
export type RecordNameResolvers = {
  /** 予定のIDから名前の表示を返す。 */
  planName: (planId: string) => ReactNode;
  /** 支払いのIDから名前の表示を返す。 */
  paymentName: (paymentId: string) => ReactNode;
};

const EMPTY_RESOLVERS: RecordNameResolvers = {
  planName: () => null,
  paymentName: () => null,
};

const ICON_BY_KIND: Record<
  TimelineItemKind,
  { icon: ReactNode; className: string }
> = {
  payment: {
    icon: <Receipt size={20} aria-hidden="true" />,
    className: "rrow-icon",
  },
  achievement: {
    icon: <CheckCircle size={20} weight="fill" aria-hidden="true" />,
    className: "rrow-icon rrow-icon-done",
  },
  booking: {
    icon: <CalendarCheck size={20} weight="fill" aria-hidden="true" />,
    className: "rrow-icon rrow-icon-booked",
  },
  achievement_cancellation: {
    icon: <ArrowUUpLeft size={18} weight="bold" aria-hidden="true" />,
    className: "rrow-icon rrow-icon-cancelled",
  },
  booking_cancellation: {
    icon: <ArrowUUpLeft size={18} weight="bold" aria-hidden="true" />,
    className: "rrow-icon rrow-icon-cancelled",
  },
  payment_cancellation: {
    icon: <ArrowUUpLeft size={18} weight="bold" aria-hidden="true" />,
    className: "rrow-icon rrow-icon-cancelled",
  },
};

/** 記録1行（予定の詳細の「関連する支払い」でも使う）。 */
export function RecordRowView({
  tripId,
  item,
  actorName,
  nameOfUser,
  resolvers = EMPTY_RESOLVERS,
  onOpenEvent,
}: {
  tripId: string;
  item: TimelineItem;
  actorName: string;
  /** userId → 表示名の解決（「〇〇が全額」の分け方表示に使う）。 */
  nameOfUser: (userId: string) => string;
  resolvers?: RecordNameResolvers;
  onOpenEvent: (item: TimelineItem) => void;
}) {
  const voided = isVoided(item);
  const icon = ICON_BY_KIND[item.kind];
  const time = timeOfDay(item.createdAt);
  const actorPart = actorName !== "" ? `${actorName} が` : "";
  const rowClass = `rrow${voided ? " rrow-voided" : ""}`;

  const event = eventOf(item);
  const payment = paymentOf(item);
  const baseKind = baseKindOf(item.kind);

  let name: ReactNode;
  let meta: string;
  let amount: string | null = null;

  if (payment !== null) {
    name = payment.label ?? "支払い";
    meta = `${time} · ${actorPart}支払い · ${shareNoteOfPayment(
      payment,
      nameOfUser,
    )}`;
    amount = formatYen(BigInt(payment.amountYen));
  } else if (event !== null) {
    name = resolvers.planName(event.planId);
    meta = `${time} · ${actorPart}${baseKindLabelOf(event.kind)}`;
  } else if (baseKind !== null) {
    // 取り消しの行: 「〇〇を取り消し・誰が」
    const cancelledName =
      baseKind === "payment"
        ? resolvers.paymentName(item.targetId)
        : item.planId !== null
          ? resolvers.planName(item.planId)
          : "支払い";
    name = <>{cancelledName}を取り消し</>;
    meta = `${time} · ${actorPart}取り消し`;
  } else {
    return null;
  }

  const inner = (
    <>
      <span className={icon.className}>{icon.icon}</span>
      <span className="rrow-main">
        <span className="rrow-name">{name}</span>
        <span className="rrow-meta">{meta}</span>
      </span>
      <span className="rrow-side">
        {amount !== null && <span className="rrow-amount">{amount}</span>}
        {voided && <span className="rrow-pill">取り消し済み</span>}
      </span>
    </>
  );

  // 支払いとその取り消しの行は支払いの詳細へ、
  // 達成・予約とその取り消しの行は小さな詳細を開く。
  if (item.kind === "payment" || item.kind === "payment_cancellation") {
    return (
      <Link
        className={`${rowClass} rrow-as-link`}
        href={`/trips/${tripId}/payments/${item.id}`}
      >
        {inner}
      </Link>
    );
  }
  return (
    <button
      type="button"
      className={`${rowClass} rrow-as-button`}
      onClick={() => onOpenEvent(item)}
    >
      {inner}
    </button>
  );
}

/** 日ごとの見出しつきの記録の一覧。itemsは新しい順を前提にする。 */
export function RecordList({
  tripId,
  items,
  actorNameOf: nameOfActor,
  resolvers,
  todayKey,
  onOpenEvent,
}: {
  tripId: string;
  items: readonly TimelineItem[];
  actorNameOf: (actorId: string) => string;
  resolvers: RecordNameResolvers;
  /** 「今日」の印を付ける日（YYYY-MM-DD）。無ければ印を出さない。 */
  todayKey: string | null;
  onOpenEvent: (item: TimelineItem) => void;
}) {
  const groups: { day: string; rows: TimelineItem[] }[] = [];
  for (const item of items) {
    const day = dayKeyOf(item.createdAt);
    const last = groups[groups.length - 1];
    if (last !== undefined && last.day === day) {
      last.rows.push(item);
    } else {
      groups.push({ day, rows: [item] });
    }
  }
  return (
    <div className="record-groups">
      {groups.map((group) => (
        <section key={group.day} className="record-group">
          <h2 className="record-day-label">
            {group.day !== "" ? formatLocalDate(group.day) : ""}
            {group.day !== "" && group.day === todayKey ? " · 今日" : ""}
          </h2>
          <div className="record-card">
            {group.rows.map((item, index) => (
              <RecordRowView
                key={`${item.kind}-${item.id}-${index}`}
                tripId={tripId}
                item={item}
                actorName={nameOfActor(item.actorId)}
                nameOfUser={nameOfActor}
                resolvers={resolvers}
                onOpenEvent={onOpenEvent}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
