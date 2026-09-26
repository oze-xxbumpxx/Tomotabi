import type { NestExpressApplication } from "@nestjs/platform-express";
import type { TestingModule } from "@nestjs/testing";
import type { Auth } from "better-auth";
import { configureApp } from "../../src/bootstrap/configure-app";

/**
 * HTTP テスト用の Nest アプリ生成。main.ts と同じく bodyParser: false で生成し、
 * configureApp で組み込み順を揃える（本番と同じ経路で要求が流れる）。
 */
export async function createHttpTestApp(
  moduleRef: TestingModule,
  auth: Auth | null,
): Promise<NestExpressApplication> {
  const app = moduleRef.createNestApplication<NestExpressApplication>({
    bodyParser: false,
  });
  configureApp(app, auth);
  await app.init();
  return app;
}
