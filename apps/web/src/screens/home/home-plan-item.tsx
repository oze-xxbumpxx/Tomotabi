"use client";

import {
  CalendarCheck,
  CheckCircle,
  Prohibit,
} from "@phosphor-icons/react";
import Link from "next/link";
import type { Plan } from "@tomotabi/contracts";
import { PLAN_KIND_LABEL, PlanKindIcon } from "@/features/plans";

/** 達成を出す予定の種類（F-46。宿・移動には達成を出さない）。 */
const ACHIEVABLE_KINDS = new Set(["place", "food", "shopping"]);

/**
 * ホームの予定の行（しおりのPlanCardと同じ並び。`from=home`で
 * 詳細からホームへ戻れる）。宿・移動には達成を出さない（F-46。
 * v3の終了後の画面の描き間違いへの対応）。
 */
export function HomePlanItem({
  tripId,
  plan,
  meId,
  meName,
  last = false,
  next = false,
}: {
  tripId: string;
  plan: Plan;
  meId: string | null;
  meName: string | null;
  last?: boolean;
  next?: boolean;
}) {
  const cancelled = plan.cancelledAt !== null;
  const achieved =
    plan.achievement !== null && ACHIEVABLE_KINDS.has(plan.kind);
  const booked = plan.booking !== null;
  const achievedBy =
    achieved && plan.achievement !== null && plan.achievement.createdBy === meId
      ? meName
      : null;

  return (
    <Link
      href={`/trips/${tripId}/plans/${plan.id}?from=home`}
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
