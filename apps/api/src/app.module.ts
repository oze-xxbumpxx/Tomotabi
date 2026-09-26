import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { LoggerModule } from "nestjs-pino";
import { ALLOWED_ORIGINS, OriginGuard } from "./common/guard/origin.guard";
import { SessionGuard } from "./common/guard/session.guard";
import { createPinoHttpOptions } from "./infrastructure/logging/logger";
import { FoundationModule } from "./modules/foundation/foundation.module";
import { IdentityModule } from "./modules/identity/identity.module";

@Module({
  imports: [
    // 要求ログの middleware は configureApp が express の先頭に載せる（認証経路も含めるため）。
    // useExisting で Nest 側はその req.log を使い、二重に出さない。
    LoggerModule.forRoot({ pinoHttp: createPinoHttpOptions(), useExisting: true }),
    FoundationModule,
    IdentityModule,
  ],
  providers: [
    {
      provide: ALLOWED_ORIGINS,
      useFactory: (): readonly string[] => {
        const origin = process.env.PUBLIC_APP_ORIGIN;
        return origin === undefined ? [] : [origin];
      },
    },
    // 全体適用。保護が既定で、公開は @PublicRoute() の明示だけにする。
    // 順序は OriginGuard → SessionGuard（Origin 不一致を認証状態に関係なく先に止める）。
    { provide: APP_GUARD, useClass: OriginGuard },
    { provide: APP_GUARD, useClass: SessionGuard },
  ],
})
export class AppModule {}
