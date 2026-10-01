"use client";

import { useEffect, useState } from "react";

const TICK_MS = 60_000;

/**
 * 1 分ごとに更新される現在時刻。タブが裏にある間はタイマーを
 * 止め、表に戻ったときに最新へ進める（visibilitychange）。
 * 描画中に window / document を触らないため、初期値は null で
 * 実際の時刻はマウント後の effect でセットする。
 */
export function useNow(): Date | null {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    let timer: number | null = null;
    const tick = () => setNow(new Date());
    const stop = () => {
      if (timer !== null) {
        window.clearInterval(timer);
        timer = null;
      }
    };
    const start = () => {
      stop();
      tick();
      timer = window.setInterval(tick, TICK_MS);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        start();
      } else {
        stop();
      }
    };
    if (document.visibilityState === "visible") {
      start();
    } else {
      tick();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  return now;
}
