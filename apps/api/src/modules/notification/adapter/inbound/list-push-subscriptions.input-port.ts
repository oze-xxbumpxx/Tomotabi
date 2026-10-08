import type { z as zod } from "zod";
import type { UserId } from "../../../../common/domain/user-id";
import type { ListPushSubscriptionsResponse } from "../../../../generated/notifications.zod";

export const LIST_PUSH_SUBSCRIPTIONS_INPUT_PORT = Symbol(
  "LIST_PUSH_SUBSCRIPTIONS_INPUT_PORT",
);

export type PushSubscriptionList = zod.infer<
  typeof ListPushSubscriptionsResponse
>;

/**
 * 自分の購読の一覧（有効・無効の両方）。sessionIdは「この端末」の
 * 印（isCurrentSession）に使う。
 */
export interface ListPushSubscriptionsInputPort {
  execute(userId: UserId, sessionId: string): Promise<PushSubscriptionList>;
}
