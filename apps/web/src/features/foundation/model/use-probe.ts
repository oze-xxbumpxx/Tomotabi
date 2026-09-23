import { useCallback, useEffect, useState } from "react";
import { getProbe, incrementProbe } from "../api/probe-api";

export function useProbe() {
  const [count, setCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const refresh = useCallback(async () => {
    setPending(true);
    setError(null);
    try {
      const probe = await getProbe();
      setCount(probe.count);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "取得に失敗しました");
    } finally {
      setPending(false);
    }
  }, []);

  const increment = useCallback(async () => {
    setPending(true);
    setError(null);
    try {
      const probe = await incrementProbe();
      setCount(probe.count);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "加算に失敗しました");
    } finally {
      setPending(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { count, error, pending, increment, refresh };
}
