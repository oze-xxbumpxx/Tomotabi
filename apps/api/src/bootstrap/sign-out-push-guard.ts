import { randomUUID } from "node:crypto";
import type { Request, RequestHandler, Response } from "express";
import type { ApiErrorBody } from "@tomotabi/contracts";
import type { SessionVerifier } from "../modules/identity/adapter/outbound/session-verifier";
import type { ClosePushSessionInputPort } from "../modules/notification/adapter/inbound/close-push-session.input-port";

function requestIdOf(request: Request): string {
  const id = (request as { id?: unknown }).id;
  return typeof id === "string" && id.length > 0 ? id : randomUUID();
}

function sendPushStopFailed(req: Request, res: Response): void {
  (res.locals ??= {}).code = "PUSH_STOP_FAILED";
  const body: ApiErrorBody = {
    code: "PUSH_STOP_FAILED",
    message: "Push notifications could not be stopped",
    requestId: requestIdOf(req),
    retryable: true,
  };
  res.status(503).json(body);
}

// 例外のmessageは接続先やトークンを含みうるため、既存の仕組みで種類だけを残す。
// res.errは1要求1行のcode判定（res.locals.codeが先）に、res.logの{err}行は
// serializeLoggedErrorで{type, errorCode}になる。messageはどちらにも出ない。
function logExceptionType(res: Response, error: unknown): void {
  res.err = error instanceof Error ? error : new Error(String(error));
  res.log?.error({ err: error });
}

/**
 * POST /api/auth/sign-outの手前に置くガード（設計書「ログアウト」）。
 * SessionVerifierの4つの結果で分ける。
 * - authenticated: 通知を止める処理を呼び、成功ならX-Push-Stopped: trueを
 *   付けてBetter Authへ渡す。DBが失敗したら503 PUSH_STOP_FAILEDを返し、
 *   ログアウトさせない（止まったと思い込んだまま通知が届くのを防ぐ）。
 * - unavailable（認証の基盤の障害）: 止められたか分からないので503。
 * - unauthenticated / forbidden: DBに触れずX-Push-Stopped: falseを付けて渡す。
 */
export function signOutPushGuard(
  sessionVerifier: SessionVerifier,
  closePushSession: ClosePushSessionInputPort,
): RequestHandler {
  const guard: RequestHandler = async (req, res, next) => {
    try {
      const result = await sessionVerifier.verify(req.headers);
      switch (result.kind) {
        case "authenticated": {
          try {
            await closePushSession.execute(result.userId, result.sessionId);
          } catch (error) {
            logExceptionType(res, error);
            sendPushStopFailed(req, res);
            return;
          }
          res.setHeader("X-Push-Stopped", "true");
          next();
          return;
        }
        case "unavailable": {
          sendPushStopFailed(req, res);
          return;
        }
        case "unauthenticated":
        case "forbidden": {
          res.setHeader("X-Push-Stopped", "false");
          next();
          return;
        }
        default: {
          // kindが増えたときはここがneverへの代入で型エラーになる。
          // 実行時に到達した場合も閉じる側（ログアウトさせない）に倒す。
          const _exhaustive: never = result;
          sendPushStopFailed(req, res);
          return;
        }
      }
    } catch (error) {
      logExceptionType(res, error);
      sendPushStopFailed(req, res);
    }
  };
  // Expressのmountは大文字小文字を区別しないため、/api/AUTH/sign-outにも
  // 載ってしまう。一方Better Authは/api/auth/*の完全一致でしか処理しない。
  // 経路制限と同じ完全一致（baseUrl＋method＋mount後のreq.path）で対象を
  // 判定しないと、Better Authが404の経路でガードだけ動き通知だけ止まる。
  return (req, res, next) => {
    if (
      req.baseUrl === "/api/auth" &&
      req.method === "POST" &&
      req.path === "/sign-out"
    ) {
      return guard(req, res, next);
    }
    next();
  };
}
