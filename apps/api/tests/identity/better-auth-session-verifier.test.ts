import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { UserId } from "../../src/common/domain/user-id";
import {
  BetterAuthSessionVerifier,
  type SessionLookup,
} from "../../src/modules/identity/infrastructure/better-auth-session-verifier";
import type { SessionVerifierHeaders } from "../../src/modules/identity/adapter/outbound/session-verifier";

const USER_ID = "550e8400-e29b-41d4-a716-446655440000";
const EXPIRES_AT = new Date("2027-01-01T00:00:00.000Z");
const HEADERS: SessionVerifierHeaders = {
  cookie: "travel.session_token=signed-cookie",
};

type SessionRecord = { session: { userId: string; expiresAt: Date } } | null;

function lookupReturning(
  impl: () => Promise<SessionRecord>,
): SessionLookup & { calls: { headers: Headers }[] } {
  const calls: { headers: Headers }[] = [];
  return {
    calls,
    getSession: async (input) => {
      calls.push(input);
      return impl();
    },
  };
}

function poolReturning(rowCount: number): Pool {
  return {
    query: vi.fn(async () => ({ rowCount, rows: [] })),
  } as unknown as Pool;
}

function poolThrowing(): Pool {
  return {
    query: vi.fn(async () => {
      throw new Error("connection refused");
    }),
  } as unknown as Pool;
}

describe("BetterAuthSessionVerifier", () => {
  it("returns unavailable when auth does not exist (no DATABASE_URL)", async () => {
    const verifier = new BetterAuthSessionVerifier(null, poolReturning(1));

    await expect(verifier.verify(HEADERS)).resolves.toEqual({
      kind: "unavailable",
    });
  });

  it("returns unavailable when the pool does not exist", async () => {
    const verifier = new BetterAuthSessionVerifier(
      lookupReturning(async () => null),
      null,
    );

    await expect(verifier.verify(HEADERS)).resolves.toEqual({
      kind: "unavailable",
    });
  });

  it("returns unauthenticated when there is no valid session", async () => {
    const verifier = new BetterAuthSessionVerifier(
      lookupReturning(async () => null),
      poolReturning(1),
    );

    await expect(verifier.verify(HEADERS)).resolves.toEqual({
      kind: "unauthenticated",
    });
  });

  it("returns unavailable when getSession throws instead of propagating", async () => {
    const lookup: SessionLookup = {
      getSession: async () => {
        throw new Error("adapter exploded");
      },
    };
    const verifier = new BetterAuthSessionVerifier(lookup, poolReturning(1));

    await expect(verifier.verify(HEADERS)).resolves.toEqual({
      kind: "unavailable",
    });
  });

  it("returns authenticated with userId and expiresAt when the allowlist matches", async () => {
    const lookup = lookupReturning(async () => ({
      session: { userId: USER_ID, expiresAt: EXPIRES_AT },
    }));
    const verifier = new BetterAuthSessionVerifier(lookup, poolReturning(1));

    const result = await verifier.verify(HEADERS);

    expect(result).toEqual({
      kind: "authenticated",
      userId: UserId.parse(USER_ID),
      expiresAt: EXPIRES_AT,
    });
  });

  it("forwards the request Cookie header into the session lookup", async () => {
    const lookup = lookupReturning(async () => null);
    const verifier = new BetterAuthSessionVerifier(lookup, poolReturning(1));

    await verifier.verify(HEADERS);

    expect(lookup.calls).toHaveLength(1);
    expect(lookup.calls[0]?.headers).toBeInstanceOf(Headers);
    expect(lookup.calls[0]?.headers.get("cookie")).toBe(
      "travel.session_token=signed-cookie",
    );
  });

  it("returns forbidden when the allowlist check fails", async () => {
    const verifier = new BetterAuthSessionVerifier(
      lookupReturning(async () => ({
        session: { userId: USER_ID, expiresAt: EXPIRES_AT },
      })),
      poolReturning(0),
    );

    await expect(verifier.verify(HEADERS)).resolves.toEqual({
      kind: "forbidden",
    });
  });

  it("returns unavailable when the allowlist query fails", async () => {
    const verifier = new BetterAuthSessionVerifier(
      lookupReturning(async () => ({
        session: { userId: USER_ID, expiresAt: EXPIRES_AT },
      })),
      poolThrowing(),
    );

    await expect(verifier.verify(HEADERS)).resolves.toEqual({
      kind: "unavailable",
    });
  });
});
