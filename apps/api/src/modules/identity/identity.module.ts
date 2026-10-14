import { Module } from "@nestjs/common";
import type { Pool } from "pg";
import { getPool } from "../../infrastructure/database/pool.js";
import {
  GET_ME_INPUT_PORT,
  type GetMeInputPort,
} from "./adapter/inbound/get-me.input-port.js";
import {
  IDENTITY_READER,
  type IdentityReader,
} from "./adapter/outbound/identity-reader.js";
import {
  SESSION_VERIFIER,
  type SessionVerifier,
} from "./adapter/outbound/session-verifier.js";
import { MeController } from "./controller/me.controller.js";
import { getAuth } from "./infrastructure/better-auth.js";
import {
  BetterAuthSessionVerifier,
  type SessionLookup,
} from "./infrastructure/better-auth-session-verifier.js";
import { PgIdentityReader } from "./infrastructure/pg-identity-reader.js";
import { GetMeUseCase } from "./usecase/get-me.usecase.js";

function runtimePool(): Pool | null {
  // DATABASE_URLが無い起動ではauthも作られず、経路はGuardが503にする。
  return process.env.DATABASE_URL ? getPool() : null;
}

@Module({
  controllers: [MeController],
  providers: [
    {
      provide: SESSION_VERIFIER,
      useFactory: (): SessionVerifier => {
        const auth = getAuth();
        const lookup: SessionLookup | null =
          auth === null
            ? null
            : { getSession: (input) => auth.api.getSession(input) };
        return new BetterAuthSessionVerifier(lookup, runtimePool());
      },
    },
    {
      provide: IDENTITY_READER,
      useFactory: (): IdentityReader => {
        const pool = runtimePool();
        // DBなし起動ではGuardが先に503を返すため、このreaderは呼ばれない。
        return pool === null
          ? { findDisplayName: async () => null }
          : new PgIdentityReader(pool);
      },
    },
    {
      provide: GET_ME_INPUT_PORT,
      useFactory: (identities: IdentityReader): GetMeInputPort =>
        new GetMeUseCase(identities),
      inject: [IDENTITY_READER],
    },
  ],
  // APP_GUARDで登録されるSessionGuard（AppModule側）が注入するためexportが要る。
  exports: [SESSION_VERIFIER],
})
export class IdentityModule {}
