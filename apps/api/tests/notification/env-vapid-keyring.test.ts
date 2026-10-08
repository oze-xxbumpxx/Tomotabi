import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  EnvVapidKeyring,
  type VapidKeyState,
} from "../../src/modules/notification/infrastructure/env-vapid-keyring";

// PU-08: VAPIDの鍵の読み込み。形が崩れた設定は例外を投げずunavailableを返し、
// 秘密鍵の値はreasonに出ない。

// 形だけ正しい鍵の材料（曲線の点であることまでは要求しない。鍵の束の読み込みが
// 確かめるのはbase64urlの形とバイト数だけ）。
const publicKeyFixture = (): string =>
  Buffer.concat([Buffer.from([0x04]), randomBytes(64)]).toString("base64url");
const privateKeyFixture = (): string => randomBytes(32).toString("base64url");

type KeyEntryInput = {
  keyId: string;
  state: VapidKeyState;
  publicKey?: string;
  privateKey?: string;
};

const SUBJECT = "mailto:push-test@example.test";

const keyringFrom = (entries: KeyEntryInput[], subject = SUBJECT) =>
  EnvVapidKeyring.fromEnv({
    VAPID_KEYS: JSON.stringify(entries),
    VAPID_SUBJECT: subject,
  });

const expectUnavailable = (
  env: Readonly<Record<string, string | undefined>>,
  secrets: readonly string[],
) => {
  const keyring = EnvVapidKeyring.fromEnv(env);
  const snapshot = keyring.snapshot;
  expect(snapshot.status).toBe("unavailable");
  if (snapshot.status === "unavailable") {
    for (const secret of secrets) {
      expect(snapshot.reason).not.toContain(secret);
    }
  }
  expect(keyring.keyFor("any")).toBeNull();
};

describe("EnvVapidKeyring (PU-08)", () => {
  it("reads a well-formed keyring with one current, retired and revoked keys", () => {
    const current = generateLike("k-current", "current");
    const retired = generateLike("k-old", "retired");
    const revoked = { keyId: "k-dead", state: "revoked" } as const;
    const keyring = keyringFrom([current, retired, revoked]);

    const snapshot = keyring.snapshot;
    expect(snapshot.status).toBe("ready");
    if (snapshot.status !== "ready") {
      return;
    }
    expect(snapshot.subject).toBe(SUBJECT);
    expect(snapshot.current.keyId).toBe("k-current");
    expect(snapshot.current.privateKey).toBe(current.privateKey);
    expect(snapshot.keys.size).toBe(3);
    expect(keyring.keyFor("k-dead")).toMatchObject({
      state: "revoked",
      privateKey: null,
    });
    expect(keyring.keyFor("k-missing")).toBeNull();
  });

  it("is unavailable when no key is current", () => {
    const retired = generateLike("k-old", "retired");
    expectUnavailable(
      { VAPID_KEYS: JSON.stringify([retired]), VAPID_SUBJECT: SUBJECT },
      [retired.privateKey],
    );
  });

  it("is unavailable when two keys are current", () => {
    const a = generateLike("k-a", "current");
    const b = generateLike("k-b", "current");
    expectUnavailable(
      { VAPID_KEYS: JSON.stringify([a, b]), VAPID_SUBJECT: SUBJECT },
      [a.privateKey, b.privateKey],
    );
  });

  it("is unavailable when keyIds repeat", () => {
    const a = generateLike("dup", "current");
    const b = generateLike("dup", "retired");
    expectUnavailable(
      { VAPID_KEYS: JSON.stringify([a, b]), VAPID_SUBJECT: SUBJECT },
      [a.privateKey, b.privateKey],
    );
  });

  it("is unavailable when a revoked key carries a privateKey", () => {
    const current = generateLike("k-current", "current");
    const revokedSecret = privateKeyFixture();
    const entries = [
      current,
      { keyId: "k-dead", state: "revoked", privateKey: revokedSecret },
    ];
    expectUnavailable(
      { VAPID_KEYS: JSON.stringify(entries), VAPID_SUBJECT: SUBJECT },
      [revokedSecret, current.privateKey],
    );
  });

  it.each([
    ["publicKeyがbase64urlでない", { publicKey: "not-base64!!" }],
    ["privateKeyがbase64urlでない", { privateKey: "not-base64!!" }],
    ["publicKeyのバイト数が違う", { publicKey: "AAAA" }],
    ["privateKeyのバイト数が違う", { privateKey: "AAAA" }],
  ])("is unavailable when %s", (_label, override) => {
    const current = { ...generateLike("k-current", "current"), ...override };
    expectUnavailable(
      { VAPID_KEYS: JSON.stringify([current]), VAPID_SUBJECT: SUBJECT },
      [current.privateKey],
    );
  });

  it("is unavailable when an entry is not an object or keyId/state is invalid", () => {
    const secret = privateKeyFixture();
    for (const raw of [
      "just-a-string",
      { keyId: "", state: "current" },
      { keyId: "k", state: "bogus" },
      { keyId: "k".repeat(65), state: "current" },
    ]) {
      const current = generateLike("k-current", "current");
      expectUnavailable(
        { VAPID_KEYS: JSON.stringify([current, raw]), VAPID_SUBJECT: SUBJECT },
        [current.privateKey, secret],
      );
    }
  });

  it("is unavailable when VAPID_KEYS is not JSON or not an array", () => {
    for (const value of ["{not json", `{"keyId":"x"}`, `42`]) {
      expectUnavailable(
        { VAPID_KEYS: value, VAPID_SUBJECT: SUBJECT },
        [],
      );
    }
  });

  it.each([
    ["undefined", undefined],
    ["empty string", ""],
    ["whitespace", "   "],
  ])("is unavailable when VAPID_KEYS is %s", (_label, value) => {
    expectUnavailable({ VAPID_KEYS: value, VAPID_SUBJECT: SUBJECT }, []);
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["not a contact URI", "push-ops@example.test"],
  ])("is unavailable when VAPID_SUBJECT is %s", (_label, subject) => {
    const current = generateLike("k-current", "current");
    expectUnavailable(
      {
        VAPID_KEYS: JSON.stringify([current]),
        VAPID_SUBJECT: subject,
      },
      [current.privateKey],
    );
  });

  it("accepts an https: subject", () => {
    const current = generateLike("k-current", "current");
    const keyring = keyringFrom([current], "https://ops.example.test/contact");
    expect(keyring.snapshot.status).toBe("ready");
  });
});

function generateLike(
  keyId: string,
  state: VapidKeyState,
): KeyEntryInput & { publicKey: string; privateKey: string } {
  return {
    keyId,
    state,
    publicKey: publicKeyFixture(),
    privateKey: privateKeyFixture(),
  };
}
