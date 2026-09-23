"use client";

import { StatusText } from "@/shared/ui/status-text";
import { useProbe } from "../model/use-probe";

export function ProbePanel() {
  const { count, error, pending, increment } = useProbe();

  return (
    <section>
      <h2>互換性プローブ</h2>
      {error ? (
        <StatusText tone="error">{error}</StatusText>
      ) : (
        <StatusText>
          {count === null ? "読み込み中です" : `現在の件数: ${count}`}
        </StatusText>
      )}
      <button type="button" disabled={pending} onClick={() => void increment()}>
        1 加算する
      </button>
    </section>
  );
}
