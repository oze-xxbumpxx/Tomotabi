import { createServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HttpsPushTransport } from "../../src/modules/notification/infrastructure/https-push-transport";
import type { PushRequestDetails } from "../../src/modules/notification/adapter/outbound/push-transport";

/**
 * localhost向けの自己署名証明書（試験専用の使い捨て。2036年まで有効）。
 * 実際の秘密情報ではないため試験ファイルに置く。
 */
const CERT = `-----BEGIN CERTIFICATE-----
MIIDCTCCAfGgAwIBAgIUOTF+bbeP79JwisGk51zglp8ldhUwDQYJKoZIhvcNAQEL
BQAwFDESMBAGA1UEAwwJbG9jYWxob3N0MB4XDTI2MTAwODIzNTkzMloXDTM2MTAw
NTIzNTkzMlowFDESMBAGA1UEAwwJbG9jYWxob3N0MIIBIjANBgkqhkiG9w0BAQEF
AAOCAQ8AMIIBCgKCAQEAm+9qap3bcsAMBupkoG1KmVpR6jR8S3ex+xWPU7k+Rtly
uWTQTfvFAd+ylJAu/jjcuvoKGjb5/DYAy0T4AQYsU1MWRCHNyf95R/Xl27yzUR/j
HwHVTR0u6J1xytscuDA7gcG8Sj7B5ptxCszu9SA3qtdRYvjU5rWC4KMNxbUSvdoe
B8ScqJcvE3I2ngvoI5B2Px6kUGZBLVrbY6klFwJppQGttSVuv9H1RJClt3IU/Pfs
Y27uIC2lSFfixpVLfMHgkmF8lUNfnix3PyUt0JhlYieTDpy/s+5mh+SHQ3EbLseC
eH2IdRRPX7tFrK3GGswDNQJK57ngTMICSNsjlvdhpQIDAQABo1MwUTAdBgNVHQ4E
FgQUo+e6b/P1NsqOnwTOtwqoayCRoRowHwYDVR0jBBgwFoAUo+e6b/P1NsqOnwTO
twqoayCRoRowDwYDVR0TAQH/BAUwAwEB/zANBgkqhkiG9w0BAQsFAAOCAQEAW4ri
Yyt+8f7V9JLLRLhu57CCH+zOdSyK8Xx/yvxL1sTCjrilahbI9KrMLbJoOVaF8Pjz
4K1GtfDqvcQl0dOfRt1TanwaqcQ5KMpR5Bd+VDh6TmSC4cj+rYyk4eYQBGfsSqQM
jmjqjRRCAX2ytdM5eruH3XZblh9tH7oSyGteISm6inh0ue5ZZZnDjKYCPv/M6Y5A
X6fXselO+AIBAOe3kRemrN0ctc1LeY+0sL2IXOQQcK5OtP31zp/o5qCJ9qIk5rYq
qokC1pi8JtFAmc0wUBBI8vIB5R0KSEB+8INyyjgihiDiNno//PQeUdd3OWn0ysuJ
btGVNw5Ew9HHs2MlLg==
-----END CERTIFICATE-----`;

const KEY = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCb72pqndtywAwG
6mSgbUqZWlHqNHxLd7H7FY9TuT5G2XK5ZNBN+8UB37KUkC7+ONy6+goaNvn8NgDL
RPgBBixTUxZEIc3J/3lH9eXbvLNRH+MfAdVNHS7onXHK2xy4MDuBwbxKPsHmm3EK
zO71IDeq11Fi+NTmtYLgow3FtRK92h4HxJyoly8TcjaeC+gjkHY/HqRQZkEtWttj
qSUXAmmlAa21JW6/0fVEkKW3chT89+xjbu4gLaVIV+LGlUt8weCSYXyVQ1+eLHc/
JS3QmGViJ5MOnL+z7maH5IdDcRsux4J4fYh1FE9fu0WsrcYazAM1AkrnueBMwgJI
2yOW92GlAgMBAAECggEAGIfzj85Bpa28tqHNLsfCwplI5bVYEG9GGp/rqlosB+1R
dQT9GCeReJf+egyst+WuI+QODs2zShAc092HvnGAK6OYjyNaQnrkU4PFo2nuM8b2
bfxV2AnNRV7vdeA+hmNgGSunOW7iBitR/0b6GKn21/ODpDRNGfZYHorIMeAokKEu
v6ObCXrgDiDNmsdhF7kKWv05/FQ4Bk8UNhWAZgzrKYW0/9yADsA0uOMXXOGIzSHU
NwXronFr1kujX8CEOEmByTQ696w+ee6sP4qNHpWXSWI7HbEd2fP/mFsClq3F/V8H
En+FNZQ8tygc6tigKhKjp7wsbHOmEed6Dkqwe6F0iQKBgQC9S/W+mfWIAyT9eulD
HGxCl+OIgSrp7QgGvPp3kCFrJgSzRZXRR+ZP7xB/v5fu4Dy+rxeoEOZdD7Y5FqpN
3gJjgw1x/xQwpfcei88sYjZYsnErYqgwRMWJq3YRciByC2QDcVpkPOW2Wvn4Zi4l
U97KF7qFMiSPn8aw/nbvrPmd1wKBgQDS4fz8OUrCGo9grWpbjXhGbJeaG3Sj6fx1
RiY/lu+p3RLEKuSWFm4qsexm7MFtAsrv59XkROK2bMm/QUbpvGbxJgXSX5PKwBA+
3yqV/L35cYytfw5x3BGiASpNc4wJv8tGk10m+SB8oLfdURZsBS5VtaSiL78RElmf
tdaZ9V104wKBgGwF5/Pf+fynBrncJTcWBjWuZbrlMy8RA86Mk0YdquRxaqc/I3Kt
XCHrY/fyxuobbq7GTnKrSjp7F9rWM1OCSMyu4cJW9ReZ7j6xPAWw+iB9nBVNFHuP
E0cv4I2uGhPaqjVIv3OKSPBaVGHLNbQ5e17KUbdm2PRZElK4s/isNjo7AoGBAI85
CLbMumdF3qbMYHW5iTxbOENj7j39Bocnk4aQnkkBamNstj7xEPVSTbpBhcThpq51
CCG2XzuCeyq3zM+mM0wIhN+yJhAHjYEF1Eh1lRi6885Jgqf1zMv4eqCLn0pnxkky
gIudm2DJTtay4cWPZz6y1ROJ1fxkOBZuS0fZCxX9AoGAUjTylFjjKo8wnfZxVFTF
gIAkeHI2mgA6xcF2KPkZMk3zFfW0gvewVcEogSOvVD+cvmXu6yasBoSX86ig38ss
Wy9xSmjCfMbQnfd5eeMUjCBrq/kkBRTRH/bC+PTeGHRADMIsWFwI7pYBNxVOdWv/
jn+xjMDTBPHVf/1KXkJlu2E=
-----END PRIVATE KEY-----`;

function requestDetails(endpoint: string): PushRequestDetails {
  return {
    endpoint,
    method: "POST",
    headers: { TTL: "300", "Content-Encoding": "aes128gcm" },
    body: Buffer.from("cipher-text"),
  };
}

describe("HttpsPushTransport（PT-01・PT-02）", () => {
  let savedTlsEnv: string | undefined;

  beforeAll(() => {
    // 試験の自己署名証明書を通すため、この試験プロセスの間だけTLSの検証を緩める。
    savedTlsEnv = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  });

  afterAll(() => {
    if (savedTlsEnv === undefined) {
      delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    } else {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = savedTlsEnv;
    }
  });

  async function withServer(
    handler: (
      req: import("node:http").IncomingMessage,
      res: import("node:http").ServerResponse,
    ) => void,
    run: (endpoint: string) => Promise<void>,
  ): Promise<void> {
    const server: Server = createServer({ cert: CERT, key: KEY }, handler);
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
    const transport = new HttpsPushTransport();
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
    const transport = new HttpsPushTransport();
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
    const transport = new HttpsPushTransport();
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
