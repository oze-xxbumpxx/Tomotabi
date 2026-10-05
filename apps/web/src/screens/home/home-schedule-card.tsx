"use client";

import { CheckCircle, DotsThree, Plus } from "@phosphor-icons/react";
import Link from "next/link";
import { Fragment } from "react";
import {
  hiddenCountOf,
  scheduleTitleOf,
  type Home,
} from "@/features/trips";
import { nextPlanOf, nowLineIndexOf } from "@/features/plans";
import {
  formatLocalDate,
  formatRemaining,
  tokyoTimeOf,
} from "@/shared/lib/local-date";
import { FetchFailed } from "@/shared/ui/state/fetch-failed";
import { HomePlanItem } from "./home-plan-item";

/**
 * ホームの予定の欄（v3のタイムラインカード。最大3件はAPIの並びのまま）。
 * - 達成済みの予定は「達成済み N 件」の行にだけまとめる（F-44）
 * - 「ほか N 件」は出していない未達成の予定の数（折りたたみ行、しおりへ）
 * - 0件は「この日の予定はまだありません」と予定の追加（欄を出さない
 *   `data: null`とは区別する。F-45）
 * - 欄の取得失敗はこのカードだけ「取得できませんでした」（F-48）
 * - 期間中で今日のカードは「今 · 次まで」の線と次の予定の強調を出す
 */
export function HomeScheduleCard({
  tripId,
  home,
  meId,
  meName,
  now,
  onRetry,
}: {
  tripId: string;
  home: Home;
  meId: string | null;
  meName: string | null;
  now: Date | null;
  onRetry: () => void;
}) {
  const section = home.schedule;
  const title = scheduleTitleOf(home.context.mode);

  if (section.status === "unavailable") {
    return (
      <section className="home-card">
        <header className="home-card-head">
          <h2 className="home-card-title">{title}</h2>
        </header>
        <div className="home-card-body">
          <FetchFailed onRetry={onRetry} />
        </div>
      </section>
    );
  }

  // `data: null`は「欄を出さない」（終了後・期間が過ぎた）。0件とは区別する。
  if (section.data === null) {
    return null;
  }

  const schedule = section.data;
  // 達成済みの予定は行に出さず「達成済み N 件」の行にだけまとめる
  // （F-44）。APIは`items`を未達成優先の最大3件で返し、未達成が
  // 3件より少ない日は達成済みも入るため、ここで除く。
  const plans = schedule.items.filter((plan) => plan.achievement === null);
  const hidden = hiddenCountOf(schedule, plans.length);
  const itinerary = `/trips/${tripId}/itinerary?date=${schedule.date}`;
  const next = now !== null ? nextPlanOf(plans, now) : null;
  const nowIndex =
    now !== null && next !== null ? nowLineIndexOf(plans, now) : -1;

  return (
    <section className="home-card">
      <header className="home-card-head">
        <h2 className="home-card-title">
          {title}
          <span className="home-card-sub tabular-nums">
            {formatLocalDate(schedule.date)} · {schedule.totalCount} 件
          </span>
        </h2>
        {schedule.totalCount > 0 && (
          <Link className="home-card-link" href={itinerary}>
            すべて見る
          </Link>
        )}
      </header>
      {schedule.totalCount === 0 ? (
        <div className="home-empty">
          <p className="home-empty-text">この日の予定はまだありません</p>
          <Link
            className="btn-outline"
            href={`/trips/${tripId}/plans/new?date=${schedule.date}`}
          >
            <Plus size={16} weight="bold" aria-hidden="true" />
            予定を追加
          </Link>
        </div>
      ) : (
        <ul className="home-plan-items">
          {schedule.achievedCount > 0 && (
            <li>
              <Link className="home-fold" href={itinerary}>
                <CheckCircle
                  size={18}
                  weight="fill"
                  className="home-fold-done"
                  aria-hidden="true"
                />
                {`達成済み ${schedule.achievedCount} 件`}
              </Link>
            </li>
          )}
          {plans.map((plan, index) => (
            <Fragment key={plan.id}>
              {index === nowIndex && now !== null && next !== null && (
                <li className="plan-now">
                  <span className="plan-now-time tabular-nums">
                    {tokyoTimeOf(now)}
                  </span>
                  <span className="plan-now-marker" aria-hidden="true">
                    <span className="plan-now-dash" />
                    <span className="plan-now-dot" />
                  </span>
                  <span className="plan-now-label">
                    {`今 · 次まで ${formatRemaining(next.remainingMinutes)}`}
                  </span>
                </li>
              )}
              <li>
                <HomePlanItem
                  tripId={tripId}
                  plan={plan}
                  meId={meId}
                  meName={meName}
                  last={index === plans.length - 1}
                  next={next !== null && plan.id === next.plan.id}
                />
              </li>
            </Fragment>
          ))}
          {hidden > 0 && (
            <li>
              <Link className="home-fold" href={itinerary}>
                <DotsThree size={18} weight="bold" aria-hidden="true" />
                {`ほか ${hidden} 件`}
              </Link>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}
