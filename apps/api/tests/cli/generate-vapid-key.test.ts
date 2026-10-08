import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CliIo } from "../../src/cli/shared/console-io";
import { CliUsageError } from "../../src/cli/shared/slot";
import {
  createVapidKey,
  runGenerateVapidKey,
} from "../../src/cli/vapid/generate-vapid-key";

const ioCapture = () => {
  const lines: string[] = [];
  const io: CliIo = {
    print: (line) => lines.push(line),
    confirm: async () => false,
  };
  return { io, lines };
};

describe("generate-vapid-key CLI", () => {
  it("creates a well-formed P-256 keypair", () => {
    const key = createVapidKey("2026-10");
    expect(key.keyId).toBe("2026-10");
    const point = Buffer.from(key.publicKey, "base64url");
    expect(point.length).toBe(65);
    expect(point[0]).toBe(4);
    expect(Buffer.from(key.privateKey, "base64url").length).toBe(32);
    // 公開鍵と秘密鍵が対になっている（EnvVapidKeyringが受理する形）
    expect(key.publicKey).toMatch(/^[A-Za-z0-9_-]{87}$/);
    expect(key.privateKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("writes the key to a mode-600 file without printing the private key", () => {
    const dir = mkdtempSync(join(tmpdir(), "vapid-"));
    const out = join(dir, "vapid.json");
    const { io, lines } = ioCapture();
    const code = runGenerateVapidKey(["--out", out, "--key-id", "2026-10"], io);
    expect(code).toBe(0);

    const written = JSON.parse(readFileSync(out, "utf8")) as {
      keyId: string;
      state: string;
      publicKey: string;
      privateKey: string;
    };
    expect(written.keyId).toBe("2026-10");
    expect(written.state).toBe("current");
    expect(written.privateKey).toMatch(/^[A-Za-z0-9_-]{43}$/);

    // 秘密鍵はどの出力行にも出ない
    for (const line of lines) {
      expect(line).not.toContain(written.privateKey);
    }
    expect(statSync(out).mode & 0o777).toBe(0o600);
  });

  it("rejects missing or unknown arguments", () => {
    const { io } = ioCapture();
    for (const argv of [[], ["--out"], ["--out", "x", "--bogus"], ["x.json"], ["--key-id", "k", "--out", "o", "--out", "p"]]) {
      expect(() => runGenerateVapidKey(argv, io)).toThrow(CliUsageError);
    }
  });
});
