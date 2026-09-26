import { useCallback, useEffect, useState } from "react";
import type { Me } from "@tomotabi/contracts";
import type { ApiFailure } from "@/shared/api/api-failure";
import { getMe } from "../api/me-api";

/** 401 と 503 は画面の出し分けに使うため、他の失敗と区別する。 */
export type MeState =
  | { status: "loading" }
  | { status: "ready"; me: Me }
  | { status: "unauthenticated" }
  | { status: "unavailable" }
  | { status: "error" };

function toState(failure: ApiFailure): MeState {
  if (failure.kind === "http" && failure.status === 401) {
    return { status: "unauthenticated" };
  }
  if (failure.kind === "http" && failure.status === 503) {
    return { status: "unavailable" };
  }
  return { status: "error" };
}

export function useMe() {
  const [state, setState] = useState<MeState>({ status: "loading" });

  const reload = useCallback(async () => {
    setState({ status: "loading" });
    await getMe().match(
      (me) => setState({ status: "ready", me }),
      (failure) => setState(toState(failure)),
    );
  }, []);

  const clear = useCallback(() => setState({ status: "loading" }), []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { state, reload, clear };
}
