import { generateVapidKeyElement } from "../../src/cli/vapid/generate-vapid-key";

export type TestVapidKeyState = "current" | "retired";

/**
 * 試験用のVAPIDの鍵の1要素を作る。本番のgenerate-vapid-keyと同じ作り方
 * （generateKeyPairSync("ec")のJWK）を使い、秘密鍵が常に32バイトになる。
 * createECDH("prime256v1").getPrivateKey()は先頭の0バイトを落として31バイトを
 * 返すことがあり（約256回に1回）、その回はEnvVapidKeyringがunavailableになって
 * ファイル全体のpush系DB試験が落ちるため、ECDHのgetPrivateKey()は使わない。
 */
export function generateTestVapidKey(
  keyId: string,
  state: TestVapidKeyState = "current",
): {
  keyId: string;
  state: TestVapidKeyState;
  publicKey: string;
  privateKey: string;
} {
  return { ...generateVapidKeyElement(keyId), state };
}
