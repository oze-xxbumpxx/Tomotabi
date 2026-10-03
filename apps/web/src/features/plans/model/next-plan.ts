import type { Plan } from "@tomotabi/contracts";
import { tokyoDateOf, tokyoInstantOf } from "@/shared/lib/local-date";

const MINUTE_MS = 60_000;

function minuteOf(instant: Date): number {
  return Math.floor(instant.getTime() / MINUTE_MS);
}

/**
 * 予定が日本時間の今日の今以降なら、開始までの残り分数を返す。
 * 取りやめ済み・時刻未定・今日でない日・時刻が過ぎた予定はnull。
 * 「今以降」は分の切り捨てで比べる（同じ分は含める）。
 */
export function minutesUntilPlan(plan: Plan, now: Date): number | null {
  if (plan.cancelledAt !== null || plan.time === null) {
    return null;
  }
  if (plan.date !== tokyoDateOf(now)) {
    return null;
  }
  const remaining =
    minuteOf(tokyoInstantOf(plan.date, plan.time)) - minuteOf(now);
  return remaining >= 0 ? remaining : null;
}

/**
 * しおりの「次の予定」。取りやめ済み・時刻未定を除き、時刻が
 * 今以降のいちばん早い予定と、そこまでの残り分数。表示中の日が
 * 日本時間の今日でない（＝該当する予定が無い）ときはnull。
 */
export function nextPlanOf(
  plans: Plan[],
  now: Date,
): { plan: Plan; remainingMinutes: number } | null {
  let next: { plan: Plan; remainingMinutes: number } | null = null;
  for (const plan of plans) {
    const remainingMinutes = minutesUntilPlan(plan, now);
    if (remainingMinutes === null) {
      continue;
    }
    if (next === null || remainingMinutes < next.remainingMinutes) {
      next = { plan, remainingMinutes };
    }
  }
  return next;
}

/**
 * 「今 · 次まで」の線を出す位置（plansのindex）。今の時刻の
 * 位置は、時刻が今以降のいちばん早い行（取りやめ済みを含む）の
 * 直前。次の予定が無い（線を出さない）ときは -1。
 */
export function nowLineIndexOf(plans: Plan[], now: Date): number {
  if (nextPlanOf(plans, now) === null) {
    return -1;
  }
  const today = tokyoDateOf(now);
  const nowMinute = minuteOf(now);
  return plans.findIndex(
    (plan) =>
      plan.time !== null &&
      plan.date === today &&
      minuteOf(tokyoInstantOf(plan.date, plan.time)) >= nowMinute,
  );
}
