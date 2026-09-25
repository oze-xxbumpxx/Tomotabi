import { Module } from "@nestjs/common";
import { LoggerModule } from "nestjs-pino";
import { createPinoHttpOptions } from "./infrastructure/logging/logger";
import { FoundationModule } from "./modules/foundation/foundation.module";

@Module({
  imports: [
    LoggerModule.forRoot({ pinoHttp: createPinoHttpOptions() }),
    FoundationModule,
  ],
})
export class AppModule {}
