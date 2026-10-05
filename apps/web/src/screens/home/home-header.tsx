"use client";

import { CaretDown, DotsThree } from "@phosphor-icons/react";
import Link from "next/link";
import {
  headerDateTextOf,
  homeBarsOf,
  type Home,
} from "@/features/trips";
import { tokyoTimeOf } from "@/shared/lib/local-date";

/**
 * 今日の帯を塗る割合（0〜100）。日本時間の今日の経過分。
 * `now`が無いあいだはv3と同じ40%で出す。
 */
function todayPercent(now: Date | null): number {
  if (now === null) {
    return 40;
  }
  const [hour, minute] = tokyoTimeOf(now).split(":").map(Number);
  return Math.min(100, Math.round(((hour * 60 + minute) / (24 * 60)) * 100));
}

/**
 * ホームのヘッダー（v3。期間の日ごとの4pxの帯つき）。
 * 「…」は旅行のメニュー、「切り替え」は旅行の一覧へ。
 */
export function HomeHeader({
  home,
  now,
  onOpenMenu,
}: {
  home: Home;
  now: Date | null;
  onOpenMenu: () => void;
}) {
  const bars = homeBarsOf(home.context, home.trip);
  const percent = todayPercent(now);
  return (
    <>
      <header className="home-header">
        <div className="home-header-main">
          <span className="home-header-date tabular-nums">
            {headerDateTextOf(home)}
          </span>
          <h1 className="home-header-name">{home.trip.name}</h1>
        </div>
        <button
          type="button"
          className="icon-button"
          onClick={onOpenMenu}
          aria-label="旅行のメニュー"
        >
          <DotsThree size={20} weight="bold" aria-hidden="true" />
        </button>
        <Link className="home-switch" href="/trips">
          切り替え
          <CaretDown size={14} weight="bold" aria-hidden="true" />
        </Link>
      </header>
      <div className="home-bars" aria-hidden="true">
        {bars.map((bar, index) =>
          bar === "today" ? (
            <span
              key={index}
              className="home-bar"
              style={{
                background: `linear-gradient(90deg, var(--color-accent) ${percent}%, var(--color-line-strong) ${percent}%)`,
              }}
            />
          ) : (
            <span
              key={index}
              className={`home-bar${bar === "past" ? " home-bar-past" : ""}`}
            />
          ),
        )}
      </div>
    </>
  );
}
