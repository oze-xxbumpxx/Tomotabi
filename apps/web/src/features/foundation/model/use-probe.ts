import { useCallback, useEffect, useState } from "react";
import type { ProbeView } from "@tomotabi/contracts";
import type { ResultAsync } from "neverthrow";
import type { ApiFailure } from "@/shared/api/api-failure";
import { getProbe, incrementProbe } from "../api/probe-api";

function toMessage(failure: ApiFailure): string {
  switch (failure.kind) {
    case "network":
      return "通信できませんでした";
    case "http":
      return `サーバーでエラーが発生しました（HTTP ${failure.status}）`;
    case "invalid-json":
    case "validation":
      return "サーバーの応答を読み取れませんでした";
  }
}

export function useProbe() {
  const [count, setCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const run = useCallback(async (request: () => ResultAsync<ProbeView, ApiFailure>) => {
    setPending(true);
    setError(null);
    // On failure the previous count is kept so an error never looks like a count of 0.
    await request().match(
      (probe) => setCount(probe.count),
      (failure) => setError(toMessage(failure)),
    );
    setPending(false);
  }, []);

  const refresh = useCallback(() => run(getProbe), [run]);
  const increment = useCallback(() => run(incrementProbe), [run]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { count, error, pending, increment, refresh };
}
