import { Module } from "@nestjs/common";
import type { Pool } from "pg";
import { getPool } from "../../infrastructure/database/pool";
import {
  SESSION_VERIFIER,
  type SessionVerifier,
} from "./adapter/outbound/session-verifier";
import { getAuth } from "./infrastructure/better-auth";
import {
  BetterAuthSessionVerifier,
  type SessionLookup,
} from "./infrastructure/better-auth-session-verifier";

function runtimePool(): Pool | null {
  // DATABASE_URL が無い起動では auth も作られず、経路は Guard が 503 にする。
  return process.env.DATABASE_URL ? getPool() : null;
}

@Module({
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
  ],
  // APP_GUARD で登録される SessionGuard（AppModule 側）が注入するため export が要る。
  exports: [SESSION_VERIFIER],
})
export class IdentityModule {}
