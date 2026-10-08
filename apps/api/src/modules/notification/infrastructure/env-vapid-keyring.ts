/**
 * 環境変数VAPID_KEYSとVAPID_SUBJECTからVAPIDの鍵の束を読む（設計書「VAPIDの鍵」）。
 *
 * VAPID_KEYSはJSONの配列で、要素は
 * `{ keyId, state: "current" | "retired" | "revoked", publicKey, privateKey }`。
 * `current`はちょうど1つ、`revoked`は秘密鍵を持たない。鍵はpaddingなしbase64urlで、
 * 公開鍵は65バイトの非圧縮点（先頭0x04）、秘密鍵は32バイト。
 *
 * 形が崩れているときは例外を投げず「通知の機能は使えない」（unavailable）を返し、
 * アプリのほかの機能は動かし続ける（GET /api/me/push-configが503になる元）。
 * 秘密鍵・公開鍵の値はreasonに入れない。
 */

import type {
  VapidKey,
  VapidKeyring,
  VapidKeyState,
} from "../domain/vapid-keyring";

// 型の定義はdomain側（adapter/domainから実装を参照しない区分のため）。
export type { VapidKey, VapidKeyring, VapidKeyState };

/** 環境変数から読んだVAPIDの鍵の束。 */
export class EnvVapidKeyring {
  private constructor(private readonly ring: VapidKeyring) {}

  /**
   * 環境変数を読んで鍵の束を作る。例外は投げない。
   * 渡すenvはテスト用。既定はprocess.env。
   */
  static fromEnv(
    env: Readonly<Record<string, string | undefined>> = process.env,
  ): EnvVapidKeyring {
    return new EnvVapidKeyring(parseVapidKeyring(env));
  }

  /** 読み込み結果。statusで絞り込んでから中身を使う。 */
  get snapshot(): VapidKeyring {
    return this.ring;
  }

  /** keyIdの鍵。unavailableのとき・一覧に無いときはnull。revokedの鍵も返す。 */
  keyFor(keyId: string): VapidKey | null {
    if (this.ring.status !== "ready") {
      return null;
    }
    return this.ring.keys.get(keyId) ?? null;
  }
}

const KEY_ID_MIN_LENGTH = 1;
const KEY_ID_MAX_LENGTH = 64;
// 65バイトの非圧縮点はpaddingなしbase64urlで87文字、32バイトの秘密鍵は43文字。
const PUBLIC_KEY_PATTERN = /^[A-Za-z0-9_-]{87}$/;
const PRIVATE_KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const PUBLIC_KEY_BYTES = 65;
const PUBLIC_KEY_FIRST_BYTE = 0x04;
const PRIVATE_KEY_BYTES = 32;
const SUBJECT_PREFIXES = ["mailto:", "https:"] as const;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isVapidKeyState = (value: unknown): value is VapidKeyState =>
  value === "current" || value === "retired" || value === "revoked";

const isBase64urlBytes = (
  value: unknown,
  pattern: RegExp,
  bytes: number,
): value is string =>
  typeof value === "string" &&
  pattern.test(value) &&
  Buffer.from(value, "base64url").length === bytes;

const isPublicKey = (value: unknown): value is string =>
  isBase64urlBytes(value, PUBLIC_KEY_PATTERN, PUBLIC_KEY_BYTES) &&
  Buffer.from(value, "base64url")[0] === PUBLIC_KEY_FIRST_BYTE;

const isPrivateKey = (value: unknown): value is string =>
  isBase64urlBytes(value, PRIVATE_KEY_PATTERN, PRIVATE_KEY_BYTES);

const isSubject = (value: unknown): value is string =>
  typeof value === "string" &&
  SUBJECT_PREFIXES.some((prefix) => value.startsWith(prefix)) &&
  SUBJECT_PREFIXES.some((prefix) => value.length > prefix.length);

const unavailable = (reason: string): VapidKeyring => ({
  status: "unavailable",
  reason,
});

/**
 * 1要素を読む。reasonは要素の位置とフィールド名だけを使い、値は入れない
 * （privateKeyの値がログやエラーに出ないようにするため）。
 */
function parseEntry(
  raw: unknown,
  index: number,
): { ok: true; key: VapidKey } | { ok: false; reason: string } {
  if (!isPlainObject(raw)) {
    return { ok: false, reason: `keys[${index}]がオブジェクトでない` };
  }
  const { keyId, state, publicKey, privateKey } = raw;
  if (
    typeof keyId !== "string" ||
    keyId.length < KEY_ID_MIN_LENGTH ||
    keyId.length > KEY_ID_MAX_LENGTH
  ) {
    return { ok: false, reason: `keys[${index}].keyIdが不正` };
  }
  if (!isVapidKeyState(state)) {
    return { ok: false, reason: `keys[${index}].stateが不正` };
  }
  if (state === "revoked") {
    // revokedは秘密鍵を持たない。公開鍵は書いてもよいが形は確かめる。
    if (privateKey !== undefined && privateKey !== null) {
      return {
        ok: false,
        reason: `keys[${index}]はrevokedだがprivateKeyを持つ`,
      };
    }
    if (publicKey !== undefined && publicKey !== null && !isPublicKey(publicKey)) {
      return { ok: false, reason: `keys[${index}].publicKeyの形が不正` };
    }
    return {
      ok: true,
      key: {
        keyId,
        state,
        publicKey: typeof publicKey === "string" ? publicKey : null,
        privateKey: null,
      },
    };
  }
  if (!isPublicKey(publicKey)) {
    return { ok: false, reason: `keys[${index}].publicKeyの形が不正` };
  }
  if (!isPrivateKey(privateKey)) {
    return { ok: false, reason: `keys[${index}].privateKeyの形が不正` };
  }
  return {
    ok: true,
    key: { keyId, state, publicKey, privateKey },
  };
}

function parseVapidKeyring(
  env: Readonly<Record<string, string | undefined>>,
): VapidKeyring {
  try {
    const rawKeys = env.VAPID_KEYS;
    if (rawKeys === undefined || rawKeys.trim() === "") {
      return unavailable("VAPID_KEYSが無い");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawKeys);
    } catch {
      return unavailable("VAPID_KEYSがJSONとして読めない");
    }
    if (!Array.isArray(parsed)) {
      return unavailable("VAPID_KEYSが配列でない");
    }

    const keys = new Map<string, VapidKey>();
    let current: VapidKey | null = null;
    let currentCount = 0;
    for (const [index, raw] of parsed.entries()) {
      const entry = parseEntry(raw, index);
      if (!entry.ok) {
        return unavailable(entry.reason);
      }
      if (keys.has(entry.key.keyId)) {
        return unavailable("keyIdの重複");
      }
      keys.set(entry.key.keyId, entry.key);
      if (entry.key.state === "current") {
        current = entry.key;
        currentCount += 1;
      }
    }
    if (currentCount !== 1 || current === null) {
      return unavailable(`currentがちょうど1つでない（${currentCount}個）`);
    }

    const subject = env.VAPID_SUBJECT;
    if (subject === undefined || subject.trim() === "") {
      return unavailable("VAPID_SUBJECTが無い");
    }
    if (!isSubject(subject)) {
      return unavailable("VAPID_SUBJECTがmailto:かhttps:で始まらない");
    }

    return { status: "ready", subject, current, keys };
  } catch {
    // ここに来るのは想定外の内部エラーだけ。それでも例外は外に出さない。
    return unavailable("VAPID_KEYSの読み込みに失敗");
  }
}
