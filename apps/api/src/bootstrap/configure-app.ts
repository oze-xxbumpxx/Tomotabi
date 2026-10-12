import type { NestExpressApplication } from "@nestjs/platform-express";
import type { Auth } from "better-auth";
import { toNodeHandler } from "better-auth/node";
import type { Express, RequestHandler } from "express";
import type { HttpLogger } from "pino-http";
import { createRequestLogger } from "../infrastructure/logging/logger";
import {
  SESSION_VERIFIER,
  type SessionVerifier,
} from "../modules/identity/adapter/outbound/session-verifier";
import {
  CLOSE_PUSH_SESSION_INPUT_PORT,
  type ClosePushSessionInputPort,
} from "../modules/notification/adapter/inbound/close-push-session.input-port";
import { authRouteAllowlist } from "./auth-route-allowlist";
import { onBeforeWriteHead, serverTiming } from "./server-timing";
import { signOutPushGuard } from "./sign-out-push-guard";

const NO_STORE_API_HEADERS = [
  ["Cache-Control", "private, no-store"],
  ["CDN-Cache-Control", "no-store"],
  ["Vercel-CDN-Cache-Control", "no-store"],
] as const;

/**
 * 全部の/apiの応答を共有のキャッシュに載せない（設計書「API 設計」）。
 * ヘッダーを書く直前に付けるので、後のhandlerがCache-Controlを
 * 自分で付けてもこの値が残る。
 */
const noStoreApiResponse: RequestHandler = (_req, res, next) => {
  onBeforeWriteHead(res, () => {
    for (const [name, value] of NO_STORE_API_HEADERS) {
      res.setHeader(name, value);
    }
  });
  next();
};

/**
 * main.tsとHTTPテストの両方から呼ぶ組み込み（ADR-0002）。
 * 順序は設計書「main.tsの組み込み順」とおりで、入れ替えない:
 *   0. pino-httpの要求ログを先頭に載せる（認証経路も1要求1行に乗せる。
 *      Nestのnestjs-pinoはuseExistingでこのreq.logを使う）
 *   0.5. Server-Timingとキャッシュを止めるヘッダー（認証の経路・404・403・
 *      503・エラーの応答を含む全部の/apiに付くよう、経路の制限の前に置く）
 *   1. bodyParser: falseで生成されたアプリに認証経路の制限を先に載せる
 *   2. /api/authのmountに通知を止めるガードを置く（ガードの中で
 *      POST /api/auth/sign-outの完全一致のときだけ動く）。その後ろに
 *      Better Authの公式Node handlerを /api/auth/*splatに載せる
 *      （authがあるときだけ。ほかの/api/auth/*の経路は変えない）
 *   3. その後ろでNest用のJSON parserを有効化する（認証経路のbodyはライブラリが読む）
 *   4. 最後に /apiプレフィックスを付ける
 */
export function configureApp(
  app: NestExpressApplication,
  auth: Auth | null,
  requestLogger: HttpLogger = createRequestLogger(),
): void {
  const http = app.getHttpAdapter().getInstance() as Express;
  const publicOrigin = process.env.PUBLIC_APP_ORIGIN ?? "";
  http.use(requestLogger);
  http.use("/api", serverTiming);
  http.use("/api", noStoreApiResponse);
  http.use("/api/auth", authRouteAllowlist(publicOrigin, auth !== null));
  if (auth !== null) {
    http.use(
      "/api/auth",
      signOutPushGuard(
        app.get<SessionVerifier>(SESSION_VERIFIER),
        app.get<ClosePushSessionInputPort>(CLOSE_PUSH_SESSION_INPUT_PORT),
      ),
    );
    http.all("/api/auth/*splat", toNodeHandler(auth));
  }
  app.useBodyParser("json");
  app.setGlobalPrefix("api");
}
