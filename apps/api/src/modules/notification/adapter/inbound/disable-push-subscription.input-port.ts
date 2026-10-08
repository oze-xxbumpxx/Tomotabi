import type { UserId } from "../../../../common/domain/user-id";

export const DISABLE_PUSH_SUBSCRIPTION_INPUT_PORT = Symbol(
  "DISABLE_PUSH_SUBSCRIPTION_INPUT_PORT",
);

/**
 * 自分の購読の無効化。他人の・無い・既に無効のIDも同じく成功として
 * 終わる（所有者を漏らさない冪等）。
 */
export interface DisablePushSubscriptionInputPort {
  execute(userId: UserId, id: string): Promise<void>;
}
