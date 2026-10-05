import {
  CalendarCheck,
  CheckCircle,
  NotePencil,
  Prohibit,
} from "@phosphor-icons/react";
import Link from "next/link";
import type { Plan, PlanEvent } from "@tomotabi/contracts";
import {
  formatDateTime,
  formatLocalDate,
  formatRemaining,
} from "@/shared/lib/local-date";
import { useNow } from "@/shared/lib/use-now";
import { minutesUntilPlan } from "../model/next-plan";
import { PLAN_KIND_LABEL, PlanKindIcon } from "./plan-kind-icon";

function recordedBy(event: PlanEvent, meId: string | null, meName: string | null) {
  if (event.createdBy === meId && meName !== null) {
    return `${meName} が `;
  }
  // 相手の表示名は公開APIに無いため、記録者は自分のときだけ名前を出す。
  return "";
}

/**
 * 予定の詳細（09）の表示部分。種類・名前・時刻・日付と、達成・予約・
 * メモの記録行。操作（編集・日の移動・取りやめ）は呼び出し側が付ける。
 */
export function PlanDetailBody({
  tripId,
  plan,
  meId,
  meName,
}: {
  tripId: string;
  plan: Plan;
  meId: string | null;
  meName: string | null;
}) {
  const cancelled = plan.cancelledAt !== null;
  // メモも記録も無い予定は空の記録カードを出さない（09）。
  const hasRecords =
    plan.achievement !== null ||
    plan.booking !== null ||
    cancelled ||
    plan.memo !== null;
  // 今日の今以降の予定なら、時刻の横に「あとN」（v3 09）。
  const now = useNow();
  const remaining = now !== null ? minutesUntilPlan(plan, now) : null;
  return (
    <>
      <div className="plan-detail-head">
        <span className="plan-kind-pill">
          <PlanKindIcon kind={plan.kind} size={15} />
          {PLAN_KIND_LABEL[plan.kind]}
        </span>
        {plan.booking !== null && (
          <span className="plan-badge plan-badge-booked">
            <CalendarCheck size={13} weight="bold" aria-hidden="true" />
            予約済み
          </span>
        )}
        {plan.achievement !== null && (
          <span className="plan-badge plan-badge-achieved">
            <CheckCircle size={13} weight="bold" aria-hidden="true" />
            達成
          </span>
        )}
        {cancelled && (
          <span className="plan-badge plan-badge-cancelled">
            <Prohibit size={13} weight="bold" aria-hidden="true" />
            取りやめ
          </span>
        )}
      </div>
      <h1
        className={
          cancelled ? "plan-detail-name plan-detail-name-cancelled" : "plan-detail-name"
        }
      >
        {plan.name}
      </h1>
      <div className="plan-detail-when">
        {plan.time !== null ? (
          <span className="plan-detail-time tabular-nums">{plan.time}</span>
        ) : (
          <span className="plan-detail-time-unset">時刻未定</span>
        )}
        <Link
          className="plan-detail-date tabular-nums"
          href={`/trips/${tripId}/itinerary?date=${plan.date}`}
        >
          {formatLocalDate(plan.date)}
        </Link>
        {remaining !== null && (
          <>
            <span className="plan-detail-when-sep" aria-hidden="true">
              ·
            </span>
            <span className="plan-detail-remaining tabular-nums">
              {`あと ${formatRemaining(remaining)}`}
            </span>
          </>
        )}
      </div>
      {hasRecords && (
      <section className="plan-records" aria-label="記録">
        {plan.achievement !== null && (
          <Link
            className="plan-record-row plan-record-row-link"
            href={`/trips/${tripId}/records?recordId=${plan.achievement.id}&recordType=achievement`}
          >
            <CheckCircle
              size={20}
              className="plan-record-icon-achieved"
              aria-hidden="true"
            />
            <div className="plan-record-main">
              <span className="plan-record-label">達成</span>
              <span className="plan-record-sub tabular-nums">
                {recordedBy(plan.achievement, meId, meName)}
                {formatDateTime(plan.achievement.createdAt)} に記録
              </span>
            </div>
          </Link>
        )}
        {plan.booking !== null && (
          <Link
            className="plan-record-row plan-record-row-link"
            href={`/trips/${tripId}/records?recordId=${plan.booking.id}&recordType=booking`}
          >
            <CalendarCheck
              size={20}
              className="plan-record-icon-booked"
              aria-hidden="true"
            />
            <div className="plan-record-main">
              <span className="plan-record-label">予約済み</span>
              <span className="plan-record-sub tabular-nums">
                {recordedBy(plan.booking, meId, meName)}
                {formatDateTime(plan.booking.createdAt)} に記録
              </span>
            </div>
          </Link>
        )}
        {cancelled && plan.cancelledAt !== null && (
          <div className="plan-record-row">
            <Prohibit
              size={20}
              className="plan-record-icon-cancelled"
              aria-hidden="true"
            />
            <div className="plan-record-main">
              <span className="plan-record-label">取りやめ</span>
              <span className="plan-record-sub tabular-nums">
                {formatDateTime(plan.cancelledAt)} に取りやめ
              </span>
            </div>
          </div>
        )}
        {plan.memo !== null && (
          <div className="plan-record-row">
            <NotePencil size={20} aria-hidden="true" />
            <span className="plan-record-memo">{plan.memo}</span>
          </div>
        )}
      </section>
      )}
    </>
  );
}
