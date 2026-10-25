"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import {
  ArrowsLeftRight,
  BookOpenText,
  House,
  ListBullets,
  Plus,
  WifiSlash,
} from "@phosphor-icons/react";
import { useOnlineStatus } from "@/shared/ui/state/use-online-status";

/**
 * 旅行の中の主な画面に出す共通の下のタブ（v3のタブ）。
 * ホーム・しおり・記録・精算の4つのタブと「支払いを記録」を1つにまとめる
 * （F-55・設計書「共通の下のタブ」）。ホームと記録の画面はまだ無いが、
 * リンクだけ置く。ホームから「支払いを記録」を開くときは関連する予定を
 * 選ばない（F-49。`/payments/new`には`planId`を付けない）。
 * オフラインのあいだは「支払いを記録」を押せない見た目にする（C-3）。
 */
export type TripTab = "home" | "itinerary" | "records" | "settlement";

const TABS: ReadonlyArray<{
  key: TripTab;
  label: string;
  icon: typeof House;
  href: (tripId: string) => string;
}> = [
  {
    key: "home",
    label: "ホーム",
    icon: House,
    href: (tripId) => `/trips/${tripId}/home`,
  },
  {
    key: "itinerary",
    label: "しおり",
    icon: BookOpenText,
    href: (tripId) => `/trips/${tripId}/itinerary`,
  },
  {
    key: "records",
    label: "履歴",
    icon: ListBullets,
    href: (tripId) => `/trips/${tripId}/records`,
  },
  {
    key: "settlement",
    label: "精算",
    icon: ArrowsLeftRight,
    href: (tripId) => `/trips/${tripId}/settlement`,
  },
];

/**
 * 画面から差し替える主ボタン。予定の詳細の「達成を記録」のように、
 * その画面の主な操作を1つ出すときに使う（v3の09）。
 * 指定が無ければ「支払いを記録」へのリンクを出す。
 */
export type TripMainAction = {
  label: string;
  icon: ReactNode;
  onPress: () => void;
  /** 保存中・保留の照合中など、今は押せないときtrue。 */
  disabled?: boolean;
  /** 画面の中に置いた説明の要素のid（`aria-describedby`で結ぶ）。 */
  describedBy?: string;
};

export function TripTabBar({
  tripId,
  current,
  action,
  quiet = false,
}: {
  tripId: string;
  /** 今の画面のタブ。`aria-current="page"`の印を付ける。 */
  current: TripTab;
  /**
   * 画面から差し替える主ボタン。省略時は「支払いを記録」。
   * `null`なら主ボタンを出さない（支払いの詳細のように、画面の中に
   * 同じ意味の操作があり、並べると重なるとき）。
   */
  action?: TripMainAction | null;
  /**
   * `true`なら既定の主ボタン「支払いを記録」を枠だけの小さな見た目
   * （`.main-action-quiet`）にする。精算の画面のように、主ボタンが
   * 脇の操作のときに使う。`action`を指定した画面には付かない。
   * 行き先と押せる条件（オフラインで押せない）は変わらない。
   */
  quiet?: boolean;
}) {
  const online = useOnlineStatus();
  // quietは既定の「支払いを記録」にだけ付ける。画面が指定した主ボタンは変えない。
  const quietClass = quiet && action === undefined ? " main-action-quiet" : "";

  return (
    <>
      {action === null ? null : online ? (
        action !== undefined ? (
          <button
            type="button"
            className="main-action"
            onClick={action.onPress}
            disabled={action.disabled}
            aria-describedby={action.describedBy}
          >
            {action.icon}
            {action.label}
          </button>
        ) : (
          <Link
            className={`main-action${quietClass}`}
            href={`/trips/${tripId}/payments/new`}
          >
            <Plus size={20} weight="bold" aria-hidden="true" />
            支払いを記録
          </Link>
        )
      ) : (
        <span
          className={`main-action${quietClass} main-action-offline`}
          aria-disabled="true"
        >
          <WifiSlash size={18} weight="bold" aria-hidden="true" />
          {action?.label ?? "支払いを記録"}
        </span>
      )}
      <nav className="tabbar" aria-label="タブ">
        <div className="tabbar-inner">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            if (tab.key === current) {
              return (
                <span
                  key={tab.key}
                  className="tabbar-item tabbar-item-current"
                  aria-current="page"
                >
                  <Icon size={24} weight="fill" aria-hidden="true" />
                  {tab.label}
                </span>
              );
            }
            return (
              <Link key={tab.key} className="tabbar-item" href={tab.href(tripId)}>
                <Icon size={24} weight="regular" aria-hidden="true" />
                {tab.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
