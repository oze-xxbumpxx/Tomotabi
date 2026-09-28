"use client";

import { useEffect, useState } from "react";

/**
 * 端末のオンライン状態。false のあいだは、保存につながるボタンを
 * `disabled` にし、押せない理由を隣に出す（C-3）。
 */
export function useOnlineStatus(): boolean {
  // 初期値はサーバー描画と同じ true にする（navigator はクライアントにしか無い）。
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setOnline(navigator.onLine);
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  return online;
}
