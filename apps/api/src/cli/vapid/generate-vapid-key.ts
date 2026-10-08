/**
 * VAPIDの鍵を1組作り、VAPID_KEYSに足す1要素のJSONをファイルに書く
 * （設計書「VAPIDの鍵」。秘密鍵は環境変数だけに置くので、標準出力には出さない）。
 */

import { generateKeyPairSync } from "node:crypto";
import { chmodSync, existsSync, writeFileSync } from "node:fs";
import { CliUsageError } from "../shared/slot";
import type { CliIo } from "../shared/console-io";

/** VAPID_KEYSの配列に足す1要素。作った鍵は未使用なのでstateはcurrent。 */
export type VapidKeyElement = {
  keyId: string;
  state: "current";
  /** base64urlの65バイト非圧縮点（87文字）。 */
  publicKey: string;
  /** base64urlの32バイト（43文字）。この値を標準出力に出してはいけない。 */
  privateKey: string;
};

const KEY_ID_MAX_LENGTH = 64;
const UNCOMPRESSED_POINT_PREFIX = 0x04;
const EC_PUBLIC_KEY_BYTES = 65;

/**
 * P-256の鍵の組を作り、VAPID用の1要素にする。
 * JWKのx・yを結んで非圧縮点（0x04 || X || Y）にし、dが秘密鍵。
 */
export function generateVapidKeyElement(keyId: string): VapidKeyElement {
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

/**
 * 引数を読む。`generate-vapid-key <出力ファイル> [--key-id <ID>]`。
 * keyIdを省略すると今月（UTCのYYYY-MM）。出力は1〜64文字。
 */
export function parseGenerateVapidKeyArgs(argv: readonly string[]): {
  outFile: string;
  keyId: string;
} {
  let outFile: string | null = null;
  let keyId: string | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--key-id") {
      keyId = argv[i + 1] ?? null;
      i += 1;
      if (keyId === null || keyId.startsWith("-")) {
        throw new CliUsageError("--key-idの値がありません");
      }
    } else if (arg.startsWith("--key-id=")) {
      keyId = arg.slice("--key-id=".length);
    } else if (arg.startsWith("-")) {
      throw new CliUsageError(`unknown argument: ${arg}`);
    } else if (outFile === null) {
      outFile = arg;
    } else {
      throw new CliUsageError(`余分な引数: ${arg}`);
    }
  }
  if (outFile === null || outFile === "") {
    throw new CliUsageError(
      "usage: generate-vapid-key <出力ファイル> [--key-id <ID>]",
    );
  }
  keyId ??= new Date().toISOString().slice(0, "YYYY-MM".length);
  if (
    keyId.length === 0 ||
    keyId.length > KEY_ID_MAX_LENGTH ||
    keyId.startsWith("-")
  ) {
    throw new CliUsageError("keyIdは1〜64文字で指定してください");
  }
  return { outFile, keyId };
}

/**
 * 鍵を作ってファイルに書く。ファイルは0600、既にあるファイルは上書きしない
 * （使っている鍵を消さないため）。秘密鍵・公開鍵は標準出力に出さない。
 */
export function runGenerateVapidKey(
  argv: readonly string[],
  io: Pick<CliIo, "print">,
): void {
  const { outFile, keyId } = parseGenerateVapidKeyArgs(argv);
  if (existsSync(outFile)) {
    throw new CliUsageError(
      `出力ファイルが既にあります。別のファイルを指定してください: ${outFile}`,
    );
  }
  const element = generateVapidKeyElement(keyId);
  writeFileSync(outFile, `${JSON.stringify(element, null, 2)}\n`, {
    mode: 0o600,
  });
  // 既存ファイルの上書きは無いので mode で足りるはずだが、万一のために揃える。
  chmodSync(outFile, 0o600);
  io.print(
    `VAPIDの鍵を作りました。keyId: ${keyId}、書き込み先: ${outFile}。` +
      "このファイルの内容をVAPID_KEYSの配列に足してください（秘密鍵はこのファイルにだけあります）。",
  );
}
