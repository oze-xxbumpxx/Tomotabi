import { describe, expect, it } from "vitest";
import { EnvVapidKeyring } from "../../src/modules/notification/infrastructure/env-vapid-keyring";
import { generateTestVapidKey } from "./vapid-keys";

describe("generateTestVapidKey", () => {
  it("多数回作った秘密鍵がすべて32バイト、公開鍵がすべて65バイト", () => {
    for (let i = 0; i < 2000; i += 1) {
      const element = generateTestVapidKey(`test-key-${i}`);
      expect(Buffer.from(element.privateKey, "base64url")).toHaveLength(32);
      expect(Buffer.from(element.publicKey, "base64url")).toHaveLength(65);
    }
  });

  it("作った鍵でEnvVapidKeyringがreadyになる", () => {
    const keyring = EnvVapidKeyring.fromEnv({
      VAPID_KEYS: JSON.stringify([
        generateTestVapidKey("current-key"),
        generateTestVapidKey("retired-key", "retired"),
        { keyId: "revoked-key", state: "revoked" },
      ]),
      VAPID_SUBJECT: "mailto:tomotabi-test@example.test",
    });
    expect(keyring.snapshot.status).toBe("ready");
    expect(keyring.snapshot.current?.keyId).toBe("current-key");
  });
});
