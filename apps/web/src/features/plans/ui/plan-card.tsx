import {
  CalendarCheck,
  CheckCircle,
  Prohibit,
} from "@phosphor-icons/react";
import Link from "next/link";
import type { Plan } from "@tomotabi/contracts";
import { PLAN_KIND_LABEL, PlanKindIcon } from "./plan-kind-icon";

/**
 * しおりの予定カード（08のタイムラインの行）。時刻・時刻未定・
 * 取りやめ・達成・予約を文字とアイコンで出す（色だけに頼らない）。
 * 押すと予定の詳細へ。`from`は見ている日（詳細の「← しおり」の戻り先）。
 */
export function PlanCard({
  tripId,
  plan,
  from,
  meId,
  meName,
  last = false,
  next = false,
}: {
  tripId: string;
  plan: Plan;
  /** 表示中のしおりの日（`YYYY-MM-DD`）。 */
  from: string;
  /** 達成の記録者の表示（自分なら表示名、それ以外は名前を出さない）。 */
  meId: string | null;
  meName: string | null;
  /** 最後の行は繋ぎ線を出さない。 */
  last?: boolean;
  /** 次の予定（今日の今以降のいちばん早い予定）。v3の強調カードにする。 */
  next?: boolean;
}) {
  const cancelled = plan.cancelledAt !== null;
  const achieved = plan.achievement !== null;
  const booked = plan.booking !== null;
  const achievedBy =
    achieved && plan.achievement !== null && plan.achievement.createdBy === meId
      ? meName
      : null;

  return (
    <Link
      href={`/trips/${tripId}/plans/${plan.id}?from=${from}`}
      className="plan-item"
    >
      <span
        className={
          plan.time === null
            ? "plan-item-time plan-item-time-unset"
            : next
              ? "plan-item-time plan-item-time-next tabular-nums"
              : "plan-item-time tabular-nums"
        }
      >
        {plan.time ?? "未定"}
      </span>
      <span
        className={
          next ? "plan-item-marker plan-item-marker-next" : "plan-item-marker"
        }
        aria-hidden="true"
      >
        {cancelled ? (
          <Prohibit size={20} className="plan-marker-cancel" />
        ) : achieved ? (
          <CheckCircle
            size={22}
            weight="fill"
            className="plan-marker-done"
          />
        ) : next ? (
          <span className="plan-marker-next" />
        ) : (
          <span className="plan-marker-ring" />
        )}
        <span
          className={
            last
              ? "plan-item-line plan-item-line-last"
              : achieved
                ? "plan-item-line plan-item-line-done"
                : "plan-item-line"
          }
        />
      </span>
      <span
        className={
          next ? "plan-item-main plan-item-main-next" : "plan-item-main"
        }
      >
        <span
          className={
            cancelled
              ? "plan-item-name plan-item-name-cancelled"
              : next
                ? "plan-item-name plan-item-name-next"
                : "plan-item-name"
          }
        >
          {plan.name}
        </span>
        <span className="plan-item-meta">
          <span className="plan-item-kind">
            <PlanKindIcon kind={plan.kind} />
            {PLAN_KIND_LABEL[plan.kind]}
          </span>
          {achieved && (
            <span className="plan-item-achieved">
              {achievedBy !== null ? `達成 · ${achievedBy}` : "達成"}
            </span>
          )}
          {booked && (
            <span className="plan-item-booked">
              <CalendarCheck size={12} weight="bold" aria-hidden="true" />
              予約
            </span>
          )}
          {cancelled && (
            <span className="plan-item-cancelled">
              <Prohibit size={12} weight="bold" aria-hidden="true" />
              取りやめ
            </span>
          )}
        </span>
      </span>
    </Link>
  );
}
