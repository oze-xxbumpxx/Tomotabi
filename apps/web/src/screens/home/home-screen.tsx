"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { SignOutButton, useMe } from "@/features/auth";
import { ProbePanel } from "@/features/foundation";
import { StatusText } from "@/shared/ui/status-text";

export function HomeScreen() {
  const router = useRouter();
  const { state, reload, clear } = useMe();

  // 401 は未ログインなので /sign-in へ。元の操作の自動再送はしない（W-05）。
  useEffect(() => {
    if (state.status === "unauthenticated") {
      router.replace("/sign-in");
    }
  }, [state.status, router]);

  if (state.status === "unavailable") {
    return (
      <main>
        <h1>ホーム</h1>
        <StatusText tone="error">
          一時的に利用できません。時間をおいて、もう一度お試しください。
        </StatusText>
        <button type="button" onClick={() => void reload()}>
          再試行
        </button>
      </main>
    );
  }

  if (state.status === "error") {
    return (
      <main>
        <h1>ホーム</h1>
        <StatusText tone="error">情報を読み込めませんでした。</StatusText>
        <button type="button" onClick={() => void reload()}>
          再試行
        </button>
      </main>
    );
  }

  if (state.status !== "ready") {
    return (
      <main>
        <StatusText>読み込み中です</StatusText>
      </main>
    );
  }

  return (
    <main>
      <h1>ホーム</h1>
      <p className="home-user">{state.me.user.displayName}</p>
      <SignOutButton
        onSignedOut={() => {
          clear();
          router.replace("/sign-in");
        }}
      />
      <ProbePanel />
    </main>
  );
}
