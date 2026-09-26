import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { EnrollmentError } from "./enrollment-error";

export const CALLBACK_PATH = "/callback";
export const DEFAULT_CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;

export type LoopbackServer = {
  redirectUri: string;
  /** 最初の callback で決着する。state 不一致・error 応答・タイムアウトは EnrollmentError。 */
  waitForCode(): Promise<string>;
  close(): Promise<void>;
};

type Outcome = { code: string } | { error: EnrollmentError };

type LoopbackOptions = {
  expectedState: string;
  timeoutMs?: number;
};

/**
 * 127.0.0.1 のランダムポートで認可コードを 1 回だけ受け取る。
 * 応答ページには受け取った値を一切書き戻さない（code / state をブラウザ履歴以外へ残さない）。
 */
export async function startLoopbackServer(options: LoopbackOptions): Promise<LoopbackServer> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_CALLBACK_TIMEOUT_MS;
  let settle: ((outcome: Outcome) => void) | null = null;
  const outcome = new Promise<Outcome>((resolve) => {
    settle = (value) => {
      settle = null;
      resolve(value);
    };
  });

  let handled = false;
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method !== "GET" || url.pathname !== CALLBACK_PATH) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("not found");
      return;
    }
    if (handled) {
      res.writeHead(410, { "content-type": "text/plain; charset=utf-8" }).end("already handled");
      return;
    }
    handled = true;
    const state = url.searchParams.get("state");
    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error");

    if (state !== options.expectedState) {
      finish(res, 400, "state mismatch", {
        error: new EnrollmentError("STATE_MISMATCH", "state が一致しません。登録を中止しました。"),
      });
      return;
    }
    if (error !== null || code === null) {
      finish(res, 400, "authorization failed", {
        error: new EnrollmentError("AUTHORIZATION_DENIED", "Google の認可が完了しませんでした。登録を中止しました。"),
      });
      return;
    }
    finish(res, 200, "Tomotabi: 認可を受け取りました。このタブを閉じて、ターミナルに戻ってください。", { code });
  });

  // 応答を送り切ってから決着させる（決着直後にサーバーを閉じるため）。
  function finish(res: ServerResponse, status: number, body: string, result: Outcome): void {
    res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
    res.end(body, () => settle?.(result));
  }

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = server.address() as AddressInfo;

  let closing: Promise<void> | null = null;
  const close = (): Promise<void> => {
    closing ??= new Promise((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
    return closing;
  };

  let timer: NodeJS.Timeout | null = null;

  return {
    redirectUri: `http://127.0.0.1:${port}${CALLBACK_PATH}`,
    async waitForCode() {
      timer = setTimeout(() => {
        settle?.({
          error: new EnrollmentError(
            "CALLBACK_TIMEOUT",
            "5 分以内に callback が届きませんでした。登録を中止しました。",
          ),
        });
      }, timeoutMs);
      try {
        const result = await outcome;
        if ("error" in result) {
          throw result.error;
        }
        return result.code;
      } finally {
        if (timer) clearTimeout(timer);
        await close();
      }
    },
    close,
  };
}
