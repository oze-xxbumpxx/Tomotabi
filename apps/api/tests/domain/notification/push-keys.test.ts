import { createECDH, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parsePushKeys } from "../../../src/modules/notification/domain/push-keys";

/** 曲線上に無い決定的な65バイト（先頭0x04、あと0x00=点(0,0)）。 */
const OFF_CURVE_P256DH = (() => {
  const bytes = Buffer.alloc(65, 0);
  bytes[0] = 0x04;
  return bytes.toString("base64url");
})();

function validKeys(): { p256dh: string; auth: string } {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    p256dh: ecdh.getPublicKey().toString("base64url"),
    auth: randomBytes(16).toString("base64url"),
  };
}

/**
 * PU-02: 鍵の形の決まり（canonicalなパディング無しbase64url・
 * 65バイトのP-256の点・16バイトのauth）。
 */
describe("parsePushKeys", () => {
  it("decodes a valid key pair into buffers", () => {
    const input = validKeys();
    const result = parsePushKeys(input);
    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.p256dh).toEqual(
        Buffer.from(input.p256dh, "base64url"),
      );
      expect(result.authSecret).toEqual(
        Buffer.from(input.auth, "base64url"),
      );
    }
  });

  it.each([
    // パディング付きはcanonicalでない
    [
      { p256dh: `${"A".repeat(86)}=`, auth: validKeys().auth },
      "p256dh_not_base64url",
    ],
    // 65バイトでない（32バイト）
    [
      {
        p256dh: randomBytes(32).toString("base64url"),
        auth: validKeys().auth,
      },
      "p256dh_wrong_form",
    ],
    // 65バイトだが圧縮形式の先頭バイト（0x02）
    [
      {
        p256dh: Buffer.concat([
          Buffer.from([0x02]),
          randomBytes(64),
        ]).toString("base64url"),
        auth: validKeys().auth,
      },
      "p256dh_wrong_form",
    ],
    // 曲線上に無い点
    [
      { p256dh: OFF_CURVE_P256DH, auth: validKeys().auth },
      "p256dh_not_on_curve",
    ],
    // authが15バイト（22文字でない）
    [
      {
        p256dh: validKeys().p256dh,
        auth: randomBytes(15).toString("base64url"),
      },
      "auth_wrong_length",
    ],
    // authがパディング付き
    [
      {
        p256dh: validKeys().p256dh,
        auth: `${randomBytes(16).toString("base64url")}==`,
      },
      "auth_not_base64url",
    ],
  ])("rejects with %s", (input, reason) => {
    expect(parsePushKeys(input)).toEqual({ ok: false, reason });
  });

  it("rejects non-canonical base64url (spare bits set)", () => {
    // 22文字のbase64urlは末尾4ビットが余る。末尾を'A'→'B'にすると
    // デコード結果は同じ16バイトだがcanonicalでない。
    const auth = `${randomBytes(16).toString("base64url").slice(0, 21)}B`;
    expect(parsePushKeys({ p256dh: validKeys().p256dh, auth })).toEqual({
      ok: false,
      reason: "auth_not_base64url",
    });
  });
});
