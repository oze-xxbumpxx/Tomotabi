import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { LoggerModule } from "nestjs-pino";
import { ALLOWED_ORIGINS, OriginGuard } from "./common/guard/origin.guard";
import { ApiErrorFilter } from "./common/http/api-error.filter";
import { SessionGuard } from "./common/guard/session.guard";
import { createPinoHttpOptions } from "./infrastructure/logging/logger";
import { FoundationModule } from "./modules/foundation/foundation.module";
import { IdentityModule } from "./modules/identity/identity.module";
import { NotificationModule } from "./modules/notification/notification.module";
import { PlanningModule } from "./modules/planning/planning.module";
import { RecordModule } from "./modules/record/record.module";
import { SettlementModule } from "./modules/settlement/settlement.module";

@Module({
  imports: [
    // 要求ログのmiddlewareはconfigureAppがexpressの先頭に載せる（認証経路も含めるため）。
    // useExistingでNest側はそのreq.logを使い、二重に出さない。
    LoggerModule.forRoot({ pinoHttp: createPinoHttpOptions(), useExisting: true }),
    FoundationModule,
    IdentityModule,
    NotificationModule,
    PlanningModule,
    RecordModule,
    SettlementModule,
  ],
  providers: [
    {
      provide: ALLOWED_ORIGINS,
      useFactory: (): readonly string[] => {
        const origin = process.env.PUBLIC_APP_ORIGIN;
        return origin === undefined ? [] : [origin];
      },
    },
    // 全例外を { code, message, requestId, retryable } に揃える（設計書「エラー応答」）。
    { provide: APP_FILTER, useClass: ApiErrorFilter },
    // 全体適用。保護が既定で、公開は @PublicRoute()の明示だけにする。
    // 順序はOriginGuard → SessionGuard（Origin不一致を認証状態に関係なく先に止める）。
    { provide: APP_GUARD, useClass: OriginGuard },
    { provide: APP_GUARD, useClass: SessionGuard },
  ],
})
export class AppModule {}
