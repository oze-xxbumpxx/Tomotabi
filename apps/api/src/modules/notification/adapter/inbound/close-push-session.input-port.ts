import type { UserId } from "../../../../common/domain/user-id";

export const CLOSE_PUSH_SESSION_INPUT_PORT = Symbol(
  "CLOSE_PUSH_SESSION_INPUT_PORT",
);

/**
 * ログアウトの前に、そのセッションの通知を止める。
 * 止められなかったときは例外を投げる（呼び出し側はログアウトさせない）。
 * 何度呼んでも同じ結果になる（冪等）。
 */
export interface ClosePushSessionInputPort {
  execute(userId: UserId, sessionId: string): Promise<void>;
}
