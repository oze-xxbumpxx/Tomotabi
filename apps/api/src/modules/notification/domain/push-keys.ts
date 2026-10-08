import { ECDH } from "node:crypto";

/**
 * Push購読の鍵の形の決まり（詳細設計「鍵の検証」）。p256dhは
 * canonicalなパディング無しbase64urlの65バイト非圧縮点でP-256の
 * 曲線上にあること、authは16バイトであることを確かめる。
 * 確かめた値はbyteaに入れるためデコードしたBufferで返す。
 */

export type PushKeysRejection =
  | "p256dh_not_base64url"
  | "p256dh_wrong_form"
  | "p256dh_not_on_curve"
  | "auth_not_base64url"
  | "auth_wrong_length";

export type PushKeys =
  | { ok: true; p256dh: Buffer; authSecret: Buffer }
  | { ok: false; reason: PushKeysRejection };

const BASE64URL_UNPADDED = /^[A-Za-z0-9_-]+$/;
const P256DH_BYTES = 65;
const AUTH_BYTES = 16;
const UNCOMPRESSED_POINT_PREFIX = 0x04;

/**
 * canonicalなパディング無しbase64urlとしてデコードする。
 * 再エンコードが元に戻ることで、パディング付き・末尾の余剰ビットが
 * 立つ表記を断る。
 */
const decodeCanonicalBase64url = (value: string): Buffer | null => {
  if (!BASE64URL_UNPADDED.test(value)) {
    return null;
  }
  const decoded = Buffer.from(value, "base64url");
  return decoded.toString("base64url") === value ? decoded : null;
};

const isOnP256Curve = (point: Buffer): boolean => {
  try {
    // convertKeyは曲線上に無い点で例外を投げる。変換の結果自体は使わない。
    ECDH.convertKey(point, "prime256v1");
    return true;
  } catch {
    return false;
  }
};

export function parsePushKeys(input: {
  p256dh: string;
  auth: string;
}): PushKeys {
  const p256dh = decodeCanonicalBase64url(input.p256dh);
  if (p256dh === null) {
    return { ok: false, reason: "p256dh_not_base64url" };
  }
  if (
    p256dh.length !== P256DH_BYTES ||
    p256dh[0] !== UNCOMPRESSED_POINT_PREFIX
  ) {
    return { ok: false, reason: "p256dh_wrong_form" };
  }
  if (!isOnP256Curve(p256dh)) {
    return { ok: false, reason: "p256dh_not_on_curve" };
  }
  const authSecret = decodeCanonicalBase64url(input.auth);
  if (authSecret === null) {
    return { ok: false, reason: "auth_not_base64url" };
  }
  if (authSecret.length !== AUTH_BYTES) {
    return { ok: false, reason: "auth_wrong_length" };
  }
  return { ok: true, p256dh, authSecret };
}
