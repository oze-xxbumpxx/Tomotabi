"use client";

import Link from "next/link";
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
    label: "記録",
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

export function TripTabBar({
  tripId,
  current,
}: {
  tripId: string;
  /** 今の画面のタブ。`aria-current="page"`の印を付ける。 */
  current: TripTab;
}) {
  const online = useOnlineStatus();

  return (
    <>
      {online ? (
        <Link
          className="main-action"
          href={`/trips/${tripId}/payments/new`}
        >
          <Plus size={20} weight="bold" aria-hidden="true" />
          支払いを記録
        </Link>
      ) : (
        <span className="main-action main-action-offline" aria-disabled="true">
          <WifiSlash size={18} weight="bold" aria-hidden="true" />
          支払いを記録
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
