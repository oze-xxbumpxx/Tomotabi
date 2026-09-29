"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useMe } from "@/features/auth";
import { getTrip } from "@/features/trips";
import {
  clearSelectedTripId,
  loadSelectedTripId,
} from "@/shared/browser/selected-trip-store";
import { isUuidString } from "@/shared/lib/uuid";
import { Loading } from "@/shared/ui/state/loading";
import { StatusText } from "@/shared/ui/status-text";

/**
 * `/` の入口（F-23）。遷移だけを担い、コンテンツは持たない。
 * 1. 利用者を取得し、その人の保存値（前回の旅行）を読む。
 * 2. 保存値があれば GET /trips/{id} で開けるか確かめる
 *    （200 → しおりへ、403 → 値を消して /trips へ）。
 * 3. 値が無い・壊れている・届かないときは /trips へ
 *    （403 以外では値を残し、次回また試す）。
 */
export function EntryScreen() {
  const router = useRouter();
  const { state, reload } = useMe();

  useEffect(() => {
    if (state.status === "unauthenticated") {
      router.replace("/sign-in");
    }
  }, [state.status, router]);

  useEffect(() => {
    if (state.status !== "ready") {
      return;
    }
    const userId = state.me.user.id;
    const saved = loadSelectedTripId(userId);
    if (saved === null || !isUuidString(saved)) {
      if (saved !== null) {
        clearSelectedTripId(userId);
      }
      router.replace("/trips");
      return;
    }
    let cancelled = false;
    void getTrip(saved).match(
      () => {
        if (!cancelled) {
          router.replace(`/trips/${saved}/itinerary`);
        }
      },
      (failure) => {
        if (cancelled) {
          return;
        }
        if (failure.kind === "http" && failure.status === 403) {
          clearSelectedTripId(userId);
        }
        router.replace("/trips");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [state, router]);

  if (state.status === "unavailable") {
    return (
      <main className="entry-page">
        <StatusText tone="error">
          一時的に利用できません。時間をおいて、もう一度お試しください。
        </StatusText>
        <button type="button" className="btn-ink" onClick={() => void reload()}>
          再試行
        </button>
      </main>
    );
  }

  if (state.status === "error") {
    return (
      <main className="entry-page">
        <StatusText tone="error">情報を読み込めませんでした。</StatusText>
        <button type="button" className="btn-ink" onClick={() => void reload()}>
          再試行
        </button>
      </main>
    );
  }

  return (
    <main className="entry-page">
      <Loading />
    </main>
  );
}
