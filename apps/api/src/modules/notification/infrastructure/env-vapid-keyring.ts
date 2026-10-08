import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";

/** VAPIDの鍵の状態。 */
export type VapidKeyState = "current" | "retired" | "revoked";

/** 署名に使える鍵（current・retired）。 */
export type VapidSigningKey = Readonly<{
  keyId: string;
  /** 65バイトの非圧縮点のbase64url。 */
  publicKey: string;
  /** 32バイトの秘密鍵のbase64url。 */
  privateKey: string;
}>;

const KEY_ID_MAX_LENGTH = 64;
const PUBLIC_KEY_BYTES = 65;
const PRIVATE_KEY_BYTES = 32;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const decodeBase64url = (value: string): Buffer | null => {
  if (!BASE64URL_PATTERN.test(value)) {
    return null;
  }
  const decoded = Buffer.from(value, "base64url");
  // パディング付き・非正準の形は受け付けない
  return decoded.toString("base64url") === value ? decoded : null;
};

/**
 * 公開鍵が65バイトの非圧縮点でP-256の曲線上にあることを確かめる。
 * x・yをJWKとして読み込めなければ曲線の外。
 */
const readP256Point = (publicKey: string): { x: string; y: string } | null => {
  const decoded = decodeBase64url(publicKey);
  if (decoded === null || decoded.length !== PUBLIC_KEY_BYTES || decoded[0] !== 4) {
    return null;
  }
  const jwk = {
    kty: "EC",
    crv: "P-256",
    x: decoded.subarray(1, 33).toString("base64url"),
    y: decoded.subarray(33, 65).toString("base64url"),
  };
  try {
    createPublicKey({ key: jwk, format: "jwk" });
  } catch {
    return null;
  }
  return { x: jwk.x, y: jwk.y };
};

/**
 * 秘密鍵が32バイトで、読み込めることと、公開鍵と対になることを確かめる。
 * Nodeは秘密鍵JWKのx・yを検証せずそのまま使うため、対の確認は署名と検証で行う。
 */
const privateKeyMatches = (publicKey: string, privateKey: string, point: { x: string; y: string }): boolean => {
  const decoded = decodeBase64url(privateKey);
  if (decoded === null || decoded.length !== PRIVATE_KEY_BYTES) {
    return false;
  }
  try {
    const signer = createPrivateKey({
      key: { kty: "EC", crv: "P-256", x: point.x, y: point.y, d: privateKey },
      format: "jwk",
    });
    const verifier = createPublicKey({
      key: { kty: "EC", crv: "P-256", x: point.x, y: point.y },
      format: "jwk",
    });
    const probe = Buffer.from("vapid-key-pair-check");
    return verify(null, probe, verifier, sign(null, probe, signer));
  } catch {
    return false;
  }
};

export type EnvVapidKeyringStatus =
  | Readonly<{ enabled: true }>
  | Readonly<{ enabled: false; reason: string }>;

/**
 * 環境変数のVAPID_KEYS（JSONの配列）とVAPID_SUBJECTを読む鍵の一覧。
 * 形が崩れていても例外は投げず、通知の機能だけが止まった状態を返す
 * （設定のAPIが503になる。アプリのほかは動く）。秘密鍵はreason・ログに出さない。
 */
export class EnvVapidKeyring {
  private constructor(
    private readonly status: EnvVapidKeyringStatus,
    private readonly subject: string | null,
    private readonly current: VapidSigningKey | null,
    private readonly signingKeys: ReadonlyMap<string, VapidSigningKey>,
    private readonly states: ReadonlyMap<string, VapidKeyState>,
  ) {}

  /**
   * envから読む。VAPID_KEYSが無い・崩れている・currentがちょうど1つでない・
   * keyIdが重複・鍵の形が誤り・VAPID_SUBJECTが無いときはdisabled。
   */
  static fromEnv(
    env: { VAPID_KEYS?: string; VAPID_SUBJECT?: string } = process.env,
  ): EnvVapidKeyring {
    return EnvVapidKeyring.load(env.VAPID_KEYS, env.VAPID_SUBJECT);
  }

  static load(keysJson: string | undefined, subject: string | undefined): EnvVapidKeyring {
    const disabled = (reason: string): EnvVapidKeyring =>
      new EnvVapidKeyring({ enabled: false, reason }, null, null, new Map(), new Map());

    if (keysJson === undefined || keysJson.trim() === "") {
      return disabled("vapid_keys_unset");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(keysJson);
    } catch {
      return disabled("vapid_keys_invalid_json");
    }
    if (!Array.isArray(parsed)) {
      return disabled("vapid_keys_invalid_json");
    }

    const signingKeys = new Map<string, VapidSigningKey>();
    const states = new Map<string, VapidKeyState>();
    let current: VapidSigningKey | null = null;
    let currentCount = 0;

    for (const entry of parsed) {
      if (!isRecord(entry)) {
        return disabled("vapid_entry_shape_invalid");
      }
      const { keyId, state, publicKey, privateKey } = entry as {
        keyId?: unknown;
        state?: unknown;
        publicKey?: unknown;
        privateKey?: unknown;
      };
      if (
        typeof keyId !== "string" ||
        keyId.length < 1 ||
        keyId.length > KEY_ID_MAX_LENGTH ||
        (state !== "current" && state !== "retired" && state !== "revoked")
      ) {
        return disabled("vapid_entry_shape_invalid");
      }
      if (states.has(keyId)) {
        return disabled("vapid_duplicate_key_id");
      }
      states.set(keyId, state);

      if (state === "revoked") {
        // revokedは秘密鍵を持たない（あれば形が崩れている）
        if (privateKey !== undefined) {
          return disabled("vapid_entry_shape_invalid");
        }
        continue;
      }

      if (typeof publicKey !== "string" || typeof privateKey !== "string") {
        return disabled("vapid_entry_shape_invalid");
      }
      const point = readP256Point(publicKey);
      if (point === null || !privateKeyMatches(publicKey, privateKey, point)) {
        return disabled("vapid_key_shape_invalid");
      }
      const key: VapidSigningKey = { keyId, publicKey, privateKey };
      signingKeys.set(keyId, key);
      if (state === "current") {
        current = key;
        currentCount += 1;
      }
    }

    if (currentCount !== 1 || current === null) {
      return disabled("vapid_current_count_invalid");
    }
    if (typeof subject !== "string" || subject.trim() === "") {
      return disabled("vapid_subject_unset");
    }

    return new EnvVapidKeyring(
      { enabled: true },
      subject,
      current,
      signingKeys,
      states,
    );
  }

  /** 通知の機能が使える設定か。 */
  getStatus(): EnvVapidKeyringStatus {
    return this.status;
  }

  /** VAPID_SUBJECT。disabledならnull。 */
  getSubject(): string | null {
    return this.subject;
  }

  /** 今の署名鍵。disabledならnull。 */
  getCurrentKey(): VapidSigningKey | null {
    return this.current;
  }

  /** keyIdの署名鍵。current・retiredだけを返し、revoked・未知・disabledはnull。 */
  getSigningKey(keyId: string): VapidSigningKey | null {
    return this.signingKeys.get(keyId) ?? null;
  }

  /** keyIdの鍵の状態。未知ならnull。 */
  getKeyState(keyId: string): VapidKeyState | null {
    return this.states.get(keyId) ?? null;
  }
}
