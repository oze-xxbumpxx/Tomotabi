import {
  ForbiddenException,
  UnsupportedMediaTypeException,
  type HttpException,
  type Type,
} from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { OriginGuard } from "../../src/common/guard/origin.guard";
import { createHttpContext } from "../support/execution-context";

const ALLOWED_ORIGIN = "http://localhost:3000";

function createGuard(): OriginGuard {
  return new OriginGuard([ALLOWED_ORIGIN]);
}

function contextWith(method: string, headers: Record<string, string>) {
  return createHttpContext({ request: { method, headers } });
}

function expectGuardError(
  guard: OriginGuard,
  method: string,
  headers: Record<string, string>,
  exceptionType: Type<HttpException>,
  status: number,
  code: string,
): void {
  let result: unknown = null;
  try {
    guard.canActivate(contextWith(method, headers));
  } catch (caught) {
    result = caught;
  }
  expect(result).toBeInstanceOf(exceptionType);
  const httpError = result as HttpException;
  expect(httpError.getStatus()).toBe(status);
  expect(httpError.getResponse()).toMatchObject({ code });
}

describe("OriginGuard", () => {
  it.each(["GET", "HEAD"])(
    "passes %s without an Origin header (U-08)",
    (method) => {
      expect(createGuard().canActivate(contextWith(method, {}))).toBe(true);
    },
  );

  it("rejects POST without an Origin header (U-09)", () => {
    expectGuardError(
      createGuard(),
      "POST",
      { "content-type": "application/json" },
      ForbiddenException,
      403,
      "FORBIDDEN_ORIGIN",
    );
  });

  it("rejects POST with Origin: null (U-09)", () => {
    expectGuardError(
      createGuard(),
      "POST",
      { origin: "null", "content-type": "application/json" },
      ForbiddenException,
      403,
      "FORBIDDEN_ORIGIN",
    );
  });

  it("rejects POST with a different Origin (U-09)", () => {
    expectGuardError(
      createGuard(),
      "POST",
      {
        origin: "http://evil.example.test",
        "content-type": "application/json",
      },
      ForbiddenException,
      403,
      "FORBIDDEN_ORIGIN",
    );
  });

  it("rejects POST when the Origin has a trailing slash (U-09)", () => {
    expectGuardError(
      createGuard(),
      "POST",
      {
        origin: `${ALLOWED_ORIGIN}/`,
        "content-type": "application/json",
      },
      ForbiddenException,
      403,
      "FORBIDDEN_ORIGIN",
    );
  });

  it("rejects POST with a non-JSON Content-Type (U-10)", () => {
    expectGuardError(
      createGuard(),
      "POST",
      { origin: ALLOWED_ORIGIN, "content-type": "text/plain" },
      UnsupportedMediaTypeException,
      415,
      "UNSUPPORTED_MEDIA_TYPE",
    );
  });

  it("passes POST with a matching Origin and JSON Content-Type", () => {
    expect(
      createGuard().canActivate(
        contextWith("POST", {
          origin: ALLOWED_ORIGIN,
          "content-type": "application/json",
        }),
      ),
    ).toBe(true);
  });
});
