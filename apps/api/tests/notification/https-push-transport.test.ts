import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { Agent, createServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HttpsPushTransport } from "../../src/modules/notification/infrastructure/https-push-transport";
import type { PushRequestDetails } from "../../src/modules/notification/adapter/outbound/push-transport";

function requestDetails(endpoint: string): PushRequestDetails {
  return {
    endpoint,
    method: "POST",
    headers: { TTL: "300", "Content-Encoding": "aes128gcm" },
    body: Buffer.from("cipher-text"),
  };
}

describe("HttpsPushTransport（PT-01・PT-02）", () => {
  let workdir: string;
  let cert = "";
  let key = "";
  let transport: HttpsPushTransport;

  beforeAll(() => {
    // 試験の中で使い捨ての自己署名証明書を作る（秘密鍵はファイルに残さない）。
    // 送る側にはこの証明書だけを信頼するagentを渡すため、プロセス全体の
    // TLSの検証は緩めない。
    workdir = mkdtempSync(join(tmpdir(), "push-tls-test-"));
    const keyPath = join(workdir, "key.pem");
    const certPath = join(workdir, "cert.pem");
    execFileSync("openssl", [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-keyout",
      keyPath,
      "-out",
      certPath,
      "-days",
      "1",
      "-nodes",
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=DNS:localhost",
    ]);
    cert = readFileSync(certPath, "utf8");
    key = readFileSync(keyPath, "utf8");
    transport = new HttpsPushTransport(new Agent({ ca: cert }));
  });

  afterAll(() => {
    rmSync(workdir, { recursive: true, force: true });
  });

  async function withServer(
    handler: (
      req: import("node:http").IncomingMessage,
      res: import("node:http").ServerResponse,
    ) => void,
    run: (endpoint: string) => Promise<void>,
  ): Promise<void> {
    const server: Server = createServer({ cert, key }, handler);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    try {
      await run(`https://localhost:${port}/x`);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeAllConnections();
    }
  }

  it("PT-01: 応答を返さないサーバーは3秒で打ち切る", async () => {
    await withServer(
      () => {
        // 何も返さない（応答を保留したまま）。
      },
      async (endpoint) => {
        const started = Date.now();
        await expect(
          transport.send(requestDetails(endpoint)),
        ).rejects.toThrow();
        expect(Date.now() - started).toBeLessThan(3_500);
      },
    );
  }, 10_000);

  it("PT-01: 本文の途中で止まるサーバーも3秒で打ち切る", async () => {
    await withServer(
      (_req, res) => {
        // 応答の前半だけ書いて途中で止める。
        res.writeHead(200, { "Content-Length": "100" });
        res.write("half");
      },
      async (endpoint) => {
        const started = Date.now();
        await expect(
          transport.send(requestDetails(endpoint)),
        ).rejects.toThrow();
        expect(Date.now() - started).toBeLessThan(3_500);
      },
    );
  }, 10_000);

  it("PT-02: 3xxを返すサーバーの転送先へは送らない", async () => {
    const hits: string[] = [];
    await withServer(
      (req, res) => {
        hits.push(req.url ?? "");
        if (req.url === "/x") {
          res.writeHead(302, { Location: "/redirected" });
          res.end();
          return;
        }
        res.writeHead(200);
        res.end();
      },
      async (endpoint) => {
        const outcome = await transport.send(requestDetails(endpoint));
        // 302はそのまま返り、/redirectedには要求を出さない。
        expect(outcome.status).toBe(302);
      },
    );
    expect(hits).toEqual(["/x"]);
  });
});
