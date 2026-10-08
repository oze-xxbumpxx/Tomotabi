import { generateKeyPairSync } from "node:crypto";
import { chmodSync, writeFileSync } from "node:fs";
import type { CliIo } from "../shared/console-io";
import { CliUsageError } from "../shared/slot";

export type GeneratedVapidKey = Readonly<{
  keyId: string;
  publicKey: string;
  privateKey: string;
}>;

/**
 * P-256の鍵を新しく作る。公開鍵は65バイトの非圧縮点のbase64url、
 * 秘密鍵は32バイトのbase64url（VAPID_KEYSの形）。
 */
export function createVapidKey(keyId: string): GeneratedVapidKey {
  const generated = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwkPublic = generated.publicKey.export({ format: "jwk" });
  const jwkPrivate = generated.privateKey.export({ format: "jwk" });
  if (
    typeof jwkPublic.x !== "string" ||
    typeof jwkPublic.y !== "string" ||
    typeof jwkPrivate.d !== "string"
  ) {
    throw new Error("鍵の生成に失敗しました");
  }
  const point = Buffer.concat([
    Buffer.from([4]),
    Buffer.from(jwkPublic.x, "base64url"),
    Buffer.from(jwkPublic.y, "base64url"),
  ]);
  return {
    keyId,
    publicKey: point.toString("base64url"),
    privateKey: jwkPrivate.d,
  };
}

const parseArgs = (argv: string[]): { out: string; keyId: string } => {
  let out: string | null = null;
  let keyId: string | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out" && i + 1 < argv.length && out === null) {
      out = argv[i + 1]!;
      i += 1;
    } else if (arg === "--key-id" && i + 1 < argv.length && keyId === null) {
      keyId = argv[i + 1]!;
      i += 1;
    } else {
      throw new CliUsageError(
        "使い方: generate-vapid-key --out <書き出すファイル> [--key-id <鍵のID>]",
      );
    }
  }
  if (out === null || out === "") {
    throw new CliUsageError(
      "使い方: generate-vapid-key --out <書き出すファイル> [--key-id <鍵のID>]",
    );
  }
  return { out, keyId: keyId ?? defaultKeyId() };
};

/** 鍵のIDの既定値（UTCの年月。設計書のVAPID_KEYSの例に合わせる）。 */
const defaultKeyId = (): string => {
  const now = new Date();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${now.getUTCFullYear()}-${month}`;
};

/**
 * 鍵を作ってファイルに書く。秘密鍵は標準出力に出さず、
 * ファイルの権限は所有者だけ読み書きできる600にする。
 */
export function runGenerateVapidKey(argv: string[], io: CliIo): number {
  const { out, keyId } = parseArgs(argv);
  const key = createVapidKey(keyId);
  const entry = {
    keyId: key.keyId,
    state: "current",
    publicKey: key.publicKey,
    privateKey: key.privateKey,
  };
  writeFileSync(out, `${JSON.stringify(entry, null, 2)}\n`, { mode: 0o600 });
  chmodSync(out, 0o600);
  io.print(`鍵を ${out} に書きました（秘密鍵を含む。中身は出力しません）`);
  io.print(`keyId: ${key.keyId}`);
  io.print(`公開鍵: ${key.publicKey}`);
  return 0;
}
