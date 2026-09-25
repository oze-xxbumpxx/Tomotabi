import {
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
  type HttpException,
  type Type,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { describe, expect, it, vi } from "vitest";
import { UserId } from "../../src/common/domain/user-id";
import { PUBLIC_ROUTE_KEY } from "../../src/common/guard/public-route.decorator";
import { SessionGuard } from "../../src/common/guard/session.guard";
import type {
  SessionVerificationResult,
  SessionVerifierHeaders,
} from "../../src/modules/identity/adapter/outbound/session-verifier";
import { createHttpContext } from "../support/execution-context";

const USER_ID = UserId.parse("3f6f84c6-3e30-4c1f-9f34-0c7f9d6e2b1a");
const HEADERS: SessionVerifierHeaders = {
  cookie: "travel.session_token=signed-cookie",
};

function createGuard(result: SessionVerificationResult): {
  guard: SessionGuard;
  verify: ReturnType<typeof vi.fn>;
} {
  const verify = vi.fn(async (_headers: SessionVerifierHeaders) => result);
  const guard = new SessionGuard(new Reflector(), { verify });
  return { guard, verify };
}

async function expectGuardError(
  promise: Promise<boolean>,
  exceptionType: Type<HttpException>,
  status: number,
  code: string,
): Promise<void> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(exceptionType);
  const httpError = error as HttpException;
  expect(httpError.getStatus()).toBe(status);
  expect(httpError.getResponse()).toMatchObject({ code });
}

describe("SessionGuard", () => {
  it("passes and sets the UserId on the request when authenticated (U-03)", async () => {
    const { guard, verify } = createGuard({
      kind: "authenticated",
      userId: USER_ID,
      expiresAt: new Date("2026-10-02T00:00:00.000Z"),
    });
    const request: Record<string, unknown> = { headers: HEADERS };
    const context = createHttpContext({ request });

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(request.userId).toBe(USER_ID);
    expect(verify).toHaveBeenCalledWith(HEADERS);
  });

  it("rejects with 401 UNAUTHENTICATED when unauthenticated (U-04)", async () => {
    const { guard } = createGuard({ kind: "unauthenticated" });
    const context = createHttpContext({ request: { headers: HEADERS } });

    await expectGuardError(
      guard.canActivate(context),
      UnauthorizedException,
      401,
      "UNAUTHENTICATED",
    );
  });

  it("rejects with 403 FORBIDDEN_NOT_ALLOWED when forbidden (U-05)", async () => {
    const { guard } = createGuard({ kind: "forbidden" });
    const context = createHttpContext({ request: { headers: HEADERS } });

    await expectGuardError(
      guard.canActivate(context),
      ForbiddenException,
      403,
      "FORBIDDEN_NOT_ALLOWED",
    );
  });

  it("rejects with 503 AUTH_UNAVAILABLE without Set-Cookie when unavailable (U-06)", async () => {
    const { guard } = createGuard({ kind: "unavailable" });
    const setHeader = vi.fn();
    const context = createHttpContext({
      request: { headers: HEADERS },
      response: { setHeader, header: setHeader },
    });

    await expectGuardError(
      guard.canActivate(context),
      ServiceUnavailableException,
      503,
      "AUTH_UNAVAILABLE",
    );
    expect(setHeader).not.toHaveBeenCalled();
  });

  it("passes without calling the verifier on a public route (U-07)", async () => {
    const { guard, verify } = createGuard({ kind: "unauthenticated" });
    const context = createHttpContext({
      request: { headers: HEADERS },
      handlerMetadata: { key: PUBLIC_ROUTE_KEY, value: true },
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(verify).not.toHaveBeenCalled();
  });
});
