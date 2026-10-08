import type { z as zod } from "zod";
import type { UserId } from "../../../../common/domain/user-id";
import type { RegisterPushSubscriptionBody } from "../../../../generated/notifications.zod";
import type { PushSubscriptionItem } from "../../domain/push-subscription";

export const PUT_PUSH_SUBSCRIPTION_INPUT_PORT = Symbol(
  "PUT_PUSH_SUBSCRIPTION_INPUT_PORT",
);

export type PushRegistrationInput = zod.infer<
  typeof RegisterPushSubscriptionBody
>;

/**
 * 購読の登録・更新。ownerはsessionのuserIdからだけ取る
 * （本文のuserIdは受け取らない）。sessionIdは停止の記録の確認と
 * registration_session_id・isCurrentSessionに使う。
 */
export interface PutPushSubscriptionInputPort {
  execute(
    userId: UserId,
    sessionId: string,
    input: PushRegistrationInput,
  ): Promise<PushSubscriptionItem>;
}
