// 試験用のVAPIDの鍵を実行ごとにメモリ上で作る（Issue #205）。
// 鍵はファイルやリポジトリに残さない。作り方は
// apps/api/src/cli/vapid/generate-vapid-key.ts のgenerateVapidKeyElementと
// 同じ（P-256の鍵の組 → JWK → 0x04||X||Yの非圧縮点とd）。
// .tsを直接読めない（相対importに拡張子が無い）ため、同じ手順をJSで再掲する。
import { generateKeyPairSync } from "node:crypto";

const UNCOMPRESSED_POINT_PREFIX = 0x04;
const EC_PUBLIC_KEY_BYTES = 65;

/**
 * VAPID_KEYSの配列に足す1要素を返す。
 * `{ keyId, state: "current", publicKey, privateKey }`（base64url・パディング無し）。
 */
export function generateVapidKeyElement(keyId) {
  const { publicKey, privateKey } = generateKeyPairSync("ec", {
    namedCurve: "P-256",
  });
  const publicJwk = publicKey.export({ format: "jwk" });
  const privateJwk = privateKey.export({ format: "jwk" });
  if (
    typeof publicJwk.x !== "string" ||
    typeof publicJwk.y !== "string" ||
    typeof privateJwk.d !== "string"
  ) {
    throw new Error("P-256の鍵の読み出しに失敗しました");
  }
  const point = Buffer.concat([
    Buffer.from([UNCOMPRESSED_POINT_PREFIX]),
    Buffer.from(publicJwk.x, "base64url"),
    Buffer.from(publicJwk.y, "base64url"),
  ]);
  if (point.length !== EC_PUBLIC_KEY_BYTES) {
    throw new Error("P-256の公開鍵の長さが不正です");
  }
  return {
    keyId,
    state: "current",
    publicKey: point.toString("base64url"),
    privateKey: privateJwk.d,
  };
}
