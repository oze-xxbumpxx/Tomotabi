import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CliUsageError } from "../../src/cli/shared/slot";
import {
  generateVapidKeyElement,
  runGenerateVapidKey,
} from "../../src/cli/vapid/generate-vapid-key";
import { EnvVapidKeyring } from "../../src/modules/notification/infrastructure/env-vapid-keyring";

// 鍵を作るCLI（設計書「VAPIDの鍵」）。1要素のJSONを0600のファイルに書き、
// 秘密鍵・公開鍵は標準出力に出さない。

let dir: string;
const lines: string[] = [];
const io = { print: (line: string) => lines.push(line) };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "vapid-key-test-"));
  lines.length = 0;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("generate-vapid-key CLI", () => {
  it("writes a one-element JSON with mode 0600 and no key on stdout", () => {
    const outFile = join(dir, "vapid-key.json");
    runGenerateVapidKey([outFile, "--key-id", "2026-10"], io);

    const stat = statSync(outFile);
    expect(stat.mode & 0o777).toBe(0o600);

    const element = JSON.parse(readFileSync(outFile, "utf8")) as {
      keyId: string;
      state: string;
      publicKey: string;
      privateKey: string;
    };
    expect(element.keyId).toBe("2026-10");
    expect(element.state).toBe("current");
    expect(element.publicKey).toMatch(/^[A-Za-z0-9_-]{87}$/);
    expect(element.privateKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // 公開鍵は0x04で始まる65バイトの非圧縮点。
    expect(Buffer.from(element.publicKey, "base64url")[0]).toBe(0x04);

    const stdout = lines.join("\n");
    expect(stdout).not.toContain(element.privateKey);
    expect(stdout).not.toContain(element.publicKey);
    expect(stdout).toContain("2026-10");
  });

  it("produces an element the keyring accepts as current", () => {
    const outFile = join(dir, "key.json");
    runGenerateVapidKey([outFile, "--key-id", "2026-10"], io);
    const element = JSON.parse(readFileSync(outFile, "utf8")) as {
      keyId: string;
      state: string;
      publicKey: string;
      privateKey: string;
    };
    const keyring = EnvVapidKeyring.fromEnv({
      VAPID_KEYS: JSON.stringify([element]),
      VAPID_SUBJECT: "mailto:push-test@example.test",
    });
    expect(keyring.snapshot.status).toBe("ready");
  });

  it("defaults the keyId to the current month", () => {
    const element = generateVapidKeyElement(
      new Date().toISOString().slice(0, 7),
    );
    const outFile = join(dir, "default-key.json");
    runGenerateVapidKey([outFile], io);
    const written = JSON.parse(readFileSync(outFile, "utf8")) as {
      keyId: string;
    };
    expect(written.keyId).toBe(element.keyId);
  });

  it("refuses to overwrite an existing file", () => {
    const outFile = join(dir, "vapid-key.json");
    runGenerateVapidKey([outFile], io);
    expect(() => runGenerateVapidKey([outFile], io)).toThrow(CliUsageError);
  });

  it.each([
    [["--key-id", "x"]],
    [[""]],
    [["out.json", "extra.json"]],
    [["out.json", "--bogus"]],
    [["out.json", "--key-id", "-x"]],
  ])("rejects bad args %j", (argv) => {
    expect(() =>
      runGenerateVapidKey(argv, io),
    ).toThrow(CliUsageError);
  });
});
