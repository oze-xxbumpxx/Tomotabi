import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Logger } from "nestjs-pino";
import { AppModule } from "./app.module";
import { configureApp } from "./bootstrap/configure-app";
import { createAuthFromEnv } from "./modules/identity/infrastructure/better-auth";

async function bootstrap(): Promise<void> {
  const auth = createAuthFromEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  configureApp(app, auth);
  app.useLogger(app.get(Logger));
  // 応答のあとに走らせる仕事（通知の送る処理など）を、終了時に最長5秒
  // 待つInProcessAfterResponse.onApplicationShutdownが動くようにする。
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
}

void bootstrap();
