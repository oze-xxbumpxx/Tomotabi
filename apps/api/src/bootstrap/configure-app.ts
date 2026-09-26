import type { NestExpressApplication } from "@nestjs/platform-express";
import type { Auth } from "better-auth";
import { toNodeHandler } from "better-auth/node";
import type { Express } from "express";
import type { HttpLogger } from "pino-http";
import { createRequestLogger } from "../infrastructure/logging/logger";
import { authRouteAllowlist } from "./auth-route-allowlist";

/**
 * main.ts と HTTP テストの両方から呼ぶ組み込み（ADR-0002）。
 * 順序は設計書「main.ts の組み込み順」とおりで、入れ替えない:
 *   0. pino-http の要求ログを先頭に載せる（認証経路も 1 要求 1 行に乗せる。
 *      Nest の nestjs-pino は useExisting でこの req.log を使う）
 *   1. bodyParser: false で生成されたアプリに認証経路の制限を先に載せる
 *   2. Better Auth の公式 Node handler を /api/auth/*splat に載せる（auth があるときだけ）
 *   3. その後ろで Nest 用の JSON parser を有効化する（認証経路の body はライブラリが読む）
 *   4. 最後に /api プレフィックスを付ける
 */
export function configureApp(
  app: NestExpressApplication,
  auth: Auth | null,
  requestLogger: HttpLogger = createRequestLogger(),
): void {
  const http = app.getHttpAdapter().getInstance() as Express;
  const publicOrigin = process.env.PUBLIC_APP_ORIGIN ?? "";
  http.use(requestLogger);
  http.use("/api/auth", authRouteAllowlist(publicOrigin, auth !== null));
  if (auth !== null) {
    http.all("/api/auth/*splat", toNodeHandler(auth));
  }
  app.useBodyParser("json");
  app.setGlobalPrefix("api");
}
