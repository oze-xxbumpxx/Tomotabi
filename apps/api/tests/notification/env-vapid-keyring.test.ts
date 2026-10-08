import { describe, expect, it } from "vitest";
import { createVapidKey } from "../../src/cli/vapid/generate-vapid-key";
import { EnvVapidKeyring } from "../../src/modules/notification/infrastructure/env-vapid-keyring";

const SUBJECT = "mailto:push-admin@example.test";

const entry = (key: { keyId: string; publicKey: string; privateKey: string }, state: string) =>
  ({ keyId: key.keyId, state, publicKey: key.publicKey, privateKey: key.privateKey });

const validKeysJson = () => {
  const current = createVapidKey("2026-10");
  const retired = createVapidKey("2026-01");
  return JSON.stringify([
    entry(current, "current"),
    entry(retired, "retired"),
    { keyId: "2025-07", state: "revoked" },
  ]);
};

const load = (keysJson: string | undefined, subject = SUBJECT) =>
  EnvVapidKeyring.load(keysJson, subject);

describe("EnvVapidKeyring (PU-08)", () => {
  it("reads a valid keyring: exactly one current, retired signs, revoked does not", () => {
    const ring = load(validKeysJson());
    expect(ring.getStatus()).toEqual({ enabled: true });
    expect(ring.getSubject()).toBe(SUBJECT);
    const current = ring.getCurrentKey();
    expect(current).not.toBeNull();
    expect(current!.keyId).toBe("2026-10");
    expect(current!.publicKey).toHaveLength(87);
    expect(ring.getSigningKey("2026-10")).toEqual(current);
    expect(ring.getSigningKey("2026-01")?.keyId).toBe("2026-01");
    expect(ring.getSigningKey("2025-07")).toBeNull();
    expect(ring.getSigningKey("no-such-key")).toBeNull();
    expect(ring.getKeyState("2025-07")).toBe("revoked");
    expect(ring.getKeyState("2026-01")).toBe("retired");
    expect(ring.getKeyState("no-such-key")).toBeNull();
  });

  it("disables (does not throw) when VAPID_KEYS is unset or empty", () => {
    for (const keysJson of [undefined, "", "   "]) {
      const ring = load(keysJson);
      expect(ring.getStatus().enabled).toBe(false);
      expect(ring.getCurrentKey()).toBeNull();
      expect(ring.getSubject()).toBeNull();
    }
  });

  it("disables for non-JSON and non-array values", () => {
    for (const keysJson of ["not-json", "{}", '"x"', "42", "null"]) {
      const ring = load(keysJson);
      expect(ring.getStatus().enabled).toBe(false);
    }
  });

  it("disables when current count is 0 or 2", () => {
    const retired = entry(createVapidKey("2026-01"), "retired");
    expect(load(JSON.stringify([retired])).getStatus().enabled).toBe(false);
    const two = JSON.stringify([
      entry(createVapidKey("2026-10"), "current"),
      entry(createVapidKey("2026-09"), "current"),
    ]);
    expect(load(two).getStatus().enabled).toBe(false);
  });

  it("disables on duplicate keyId", () => {
    const json = JSON.stringify([
      entry(createVapidKey("2026-10"), "current"),
      { keyId: "2026-10", state: "revoked" },
    ]);
    expect(load(json).getStatus().enabled).toBe(false);
  });

  it("disables on malformed key material", () => {
    const good = createVapidKey("2026-10");
    const other = createVapidKey("2026-10");
    const cases = [
      { ...entry(good, "current"), publicKey: "!!!" },
      { ...entry(good, "current"), publicKey: good.publicKey.slice(0, 80) },
      { ...entry(good, "current"), privateKey: other.privateKey },
      { ...entry(good, "current"), publicKey: `${good.publicKey}=` },
      { keyId: "x", state: "current", publicKey: good.publicKey },
    ];
    for (const badEntry of cases) {
      expect(load(JSON.stringify([badEntry])).getStatus().enabled).toBe(false);
    }
  });

  it("disables when a revoked entry carries a privateKey", () => {
    const json = JSON.stringify([
      entry(createVapidKey("2026-10"), "current"),
      { keyId: "2025-07", state: "revoked", privateKey: createVapidKey("x").privateKey },
    ]);
    expect(load(json).getStatus().enabled).toBe(false);
  });

  it("disables on malformed entries (bad keyId or state)", () => {
    const good = createVapidKey("2026-10");
    const cases = [
      [{ keyId: "", state: "current", publicKey: good.publicKey, privateKey: good.privateKey }],
      [{ keyId: "x".repeat(65), state: "current", publicKey: good.publicKey, privateKey: good.privateKey }],
      [{ keyId: "k", state: "unknown", publicKey: good.publicKey, privateKey: good.privateKey }],
      ["string-entry"],
      [null],
    ];
    for (const c of cases) {
      expect(load(JSON.stringify(c)).getStatus().enabled).toBe(false);
    }
  });

  it("disables when VAPID_SUBJECT is missing", () => {
    expect(EnvVapidKeyring.load(validKeysJson(), undefined).getStatus().enabled).toBe(false);
    expect(load(validKeysJson(), "  ").getStatus().enabled).toBe(false);
  });
});
