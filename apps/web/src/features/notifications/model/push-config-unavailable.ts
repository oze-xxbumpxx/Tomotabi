import { isApiFailure } from "@/shared/api/api-failure";

/**
 * `GET /api/me/push-config`の503（PUSH_UNAVAILABLE）。鍵の設定が
 * 崩れているときを一覧の`vapidKeyState`より先に「使えない」と
 * 判定するための共通の見方（PU-14）。
 */
export function isPushConfigUnavailable(error: unknown): boolean {
  return (
    isApiFailure(error) && error.kind === "http" && error.status === 503
  );
}
