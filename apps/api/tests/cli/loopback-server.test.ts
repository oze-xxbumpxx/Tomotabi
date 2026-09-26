import { describe, expect, it } from "vitest";
import { EnrollmentError } from "../../src/cli/enroll/enrollment-error";
import { startLoopbackServer } from "../../src/cli/enroll/loopback-server";

const callback = (redirectUri: string, params: Record<string, string>) =>
  fetch(`${redirectUri}?${new URLSearchParams(params).toString()}`);

// 決着が先に来ても unhandled rejection にしないため、reject を値に変えて受ける
const settled = (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => null,
    (error: unknown) => error,
  );

const expectCode = async (settledPromise: Promise<unknown>, code: string): Promise<void> => {
  const error = await settledPromise;
  expect(error).toBeInstanceOf(EnrollmentError);
  expect((error as EnrollmentError).code).toBe(code);
};

describe("loopback server", () => {
  it("listens on 127.0.0.1 with a random port and returns the code once state matches", async () => {
    const server = await startLoopbackServer({ expectedState: "expected" });
    expect(server.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    const waiting = server.waitForCode();
    const res = await callback(server.redirectUri, {
      state: "expected",
      code: "auth-code",
    });
    expect(res.status).toBe(200);
    expect(await res.text()).not.toContain("auth-code");
    await expect(waiting).resolves.toBe("auth-code");
    await expect(fetch(server.redirectUri)).rejects.toThrow();
  });

  it("rejects with STATE_MISMATCH and does not hand over the code", async () => {
    const server = await startLoopbackServer({ expectedState: "expected" });
    const waiting = settled(server.waitForCode());
    const res = await callback(server.redirectUri, {
      state: "tampered",
      code: "auth-code",
    });
    expect(res.status).toBe(400);
    expect(await res.text()).not.toContain("auth-code");
    await expectCode(waiting, "STATE_MISMATCH");
  });

  it("rejects with AUTHORIZATION_DENIED when Google returns error", async () => {
    const server = await startLoopbackServer({ expectedState: "expected" });
    const waiting = settled(server.waitForCode());
    await callback(server.redirectUri, {
      state: "expected",
      error: "access_denied",
    });
    await expectCode(waiting, "AUTHORIZATION_DENIED");
  });

  it("rejects with CALLBACK_TIMEOUT when nothing arrives", async () => {
    const server = await startLoopbackServer({
      expectedState: "expected",
      timeoutMs: 50,
    });
    await expectCode(settled(server.waitForCode()), "CALLBACK_TIMEOUT");
  });

  it("returns 404 for other paths and keeps waiting", async () => {
    const server = await startLoopbackServer({ expectedState: "expected" });
    const waiting = server.waitForCode();
    const base = server.redirectUri.replace(/\/callback$/, "");
    expect((await fetch(`${base}/other`)).status).toBe(404);
    await callback(server.redirectUri, { state: "expected", code: "c" });
    await expect(waiting).resolves.toBe("c");
  });
});
