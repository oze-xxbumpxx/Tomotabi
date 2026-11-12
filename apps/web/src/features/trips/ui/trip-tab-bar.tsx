"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import {
  ArrowsLeftRight,
  BookOpenText,
  House,
  ListBullets,
  ListChecks,
  Plus,
  WifiSlash,
} from "@phosphor-icons/react";
import { useOnlineStatus } from "@/shared/ui/state/use-online-status";

/**
 * 旅行の中の主な画面に出す共通の下のタブ（v3のタブ）。
 * ホーム・しおり・ToDo・履歴・精算の5つのタブと、その上の主ボタンを1つにまとめる
 * （F-55・設計書「共通の下のタブ」）。主ボタン「支払いを記録」を出すのは
 * ホームと履歴（支払いの詳細を含む）だけで、しおり・ToDo・精算は`action={null}`で
 * 出さない（2026-11-09 ユーザーの判断。どの画面にも出ているのは違和感がある）。
 * 「支払いを記録」は関連する予定を選ばずに開く
 * （F-49。`/payments/new`には`planId`を付けず、開いた画面を`back`で渡す）。
 * オフラインのあいだは主ボタンを押せない見た目にする（C-3）。
 */
export type TripTab = "home" | "itinerary" | "todos" | "records" | "settlement";

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
    key: "todos",
    label: "ToDo",
    icon: ListChecks,
    href: (tripId) => `/trips/${tripId}/todos`,
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
  recordsQuery,
}: {
  tripId: string;
  /** 今の画面のタブ。`aria-current="page"`の印を付ける。 */
  current: TripTab;
  /**
   * 画面から差し替える主ボタン。省略時は「支払いを記録」。
   * `null`なら主ボタンを出さない（しおり・ToDo・精算の画面と、
   * 画面の中に同じ意味の操作がある取り消し済みの支払いの詳細）。
   */
  action?: TripMainAction | null;
  /** 履歴の絞り込み（`/records`の問い合わせ）。履歴から開くときだけ`records`に入れる。 */
  recordsQuery?: string | null;
}) {
  const online = useOnlineStatus();
  // 保存したあとと閉じたときに、開いた画面（ホームか履歴）へ戻すための印。
  const recordsQueryParam =
    current === "records" && recordsQuery
      ? `&records=${encodeURIComponent(recordsQuery)}`
      : "";
  const backQuery =
    current === "home" || current === "records"
      ? `?back=${current}${recordsQueryParam}`
      : "";

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
            className="main-action"
            href={`/trips/${tripId}/payments/new${backQuery}`}
          >
            <Plus size={20} weight="bold" aria-hidden="true" />
            支払いを記録
          </Link>
        )
      ) : (
        <span className="main-action main-action-offline" aria-disabled="true">
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
