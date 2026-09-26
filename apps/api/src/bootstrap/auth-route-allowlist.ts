import type { RequestHandler } from "express";

type PublicAuthRoute = {
  /** POST は公開アプリのオリジンとの完全一致を要求する（CSRF 対策）。 */
  requiresOrigin: boolean;
};

// 「METHOD path」をキーにした許可リスト。メソッド違いはキーが無いので 404 になる。
// path は /api/auth への mount 後の相対パス（express の req.path）で判定する。
const PUBLIC_ROUTES: Readonly<Record<string, PublicAuthRoute>> = {
  "POST /sign-in/social": { requiresOrigin: true },
  "GET /callback/google": { requiresOrigin: false },
  "POST /sign-out": { requiresOrigin: true },
  "GET /error": { requiresOrigin: false },
};

function sendJson(
  res: Parameters<RequestHandler>[1],
  status: number,
  code: string,
  message: string,
): void {
  res.locals.code = code;
  res.status(status).json({ code, message });
}

/**
 * 公開 4 経路以外の /api/auth/* を 404 にする経路制限ミドルウェア。
 * sign-in / sign-out の POST は Origin が公開オリジンと完全一致しなければ 403。
 * auth が生成されていない（DATABASE_URL なし）ときは公開経路を 503 にする。
 */
export function authRouteAllowlist(
  publicOrigin: string,
  authAvailable: boolean,
): RequestHandler {
  return (req, res, next) => {
    const route = PUBLIC_ROUTES[`${req.method} ${req.path}`];
    if (route === undefined) {
      res.status(404).json({ code: "NOT_FOUND", message: "Not Found" });
      return;
    }
    if (
      route.requiresOrigin &&
      (publicOrigin === "" || req.headers.origin !== publicOrigin)
    ) {
      sendJson(res, 403, "FORBIDDEN_ORIGIN", "Origin is not allowed");
      return;
    }
    if (!authAvailable) {
      sendJson(
        res,
        503,
        "AUTH_UNAVAILABLE",
        "Authentication is temporarily unavailable",
      );
      return;
    }
    next();
  };
}
