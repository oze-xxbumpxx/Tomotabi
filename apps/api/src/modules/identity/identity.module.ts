import { Module } from "@nestjs/common";
import type { Pool } from "pg";
import { getPool } from "../../infrastructure/database/pool";
import {
  GET_ME_INPUT_PORT,
  type GetMeInputPort,
} from "./adapter/inbound/get-me.input-port";
import {
  IDENTITY_READER,
  type IdentityReader,
} from "./adapter/outbound/identity-reader";
import {
  SESSION_VERIFIER,
  type SessionVerifier,
} from "./adapter/outbound/session-verifier";
import { MeController } from "./controller/me.controller";
import { getAuth } from "./infrastructure/better-auth";
import {
  BetterAuthSessionVerifier,
  type SessionLookup,
} from "./infrastructure/better-auth-session-verifier";
import { PgIdentityReader } from "./infrastructure/pg-identity-reader";
import { GetMeUseCase } from "./usecase/get-me.usecase";

function runtimePool(): Pool | null {
  // DATABASE_URL が無い起動では auth も作られず、経路は Guard が 503 にする。
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
        // DB なし起動では Guard が先に 503 を返すため、この reader は呼ばれない。
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
  // APP_GUARD で登録される SessionGuard（AppModule 側）が注入するため export が要る。
  exports: [SESSION_VERIFIER],
})
export class IdentityModule {}
