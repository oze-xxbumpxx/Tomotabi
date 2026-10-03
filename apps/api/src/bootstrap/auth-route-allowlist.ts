import type { RequestHandler } from "express";

type PublicAuthRoute = {
  /** POSTは公開アプリのオリジンとの完全一致を要求する（CSRF対策）。 */
  requiresOrigin: boolean;
};

// 「METHOD path」をキーにした許可リスト。メソッド違いはキーが無いので404になる。
// pathは /api/authへのmount後の相対パス（expressのreq.path）で判定する。
const PUBLIC_ROUTES: Readonly<Record<string, PublicAuthRoute>> = {
  "POST /sign-in/social": { requiresOrigin: true },
  "GET /callback/google": { requiresOrigin: false },
  "POST /sign-out": { requiresOrigin: true },
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
 * 公開3経路以外の /api/auth/* を404にする経路制限ミドルウェア。
 * sign-in / sign-outのPOSTはOriginが公開オリジンと完全一致しなければ403。
 * authが生成されていない（DATABASE_URLなし）ときは公開経路を503にする。
 */
export function authRouteAllowlist(
  publicOrigin: string,
  authAvailable: boolean,
): RequestHandler {
  return (req, res, next) => {
    const route = PUBLIC_ROUTES[`${req.method} ${req.path}`];
    if (route === undefined) {
      sendJson(res, 404, "NOT_FOUND", "Not Found");
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
