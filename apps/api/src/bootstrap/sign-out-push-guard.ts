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
  return async (req, res, next) => {
    try {
      const result = await sessionVerifier.verify(req.headers);
      switch (result.kind) {
        case "authenticated": {
          try {
            await closePushSession.execute(result.userId, result.sessionId);
          } catch {
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
      }
    } catch {
      sendPushStopFailed(req, res);
    }
  };
}
