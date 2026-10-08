import type { UserId } from "../../../common/domain/user-id";
import type {
  ListPushSubscriptionsInputPort,
  PushSubscriptionList,
} from "../adapter/inbound/list-push-subscriptions.input-port";
import type { NotificationUnitOfWork } from "../adapter/outbound/push-subscription.repository";
import type { VapidKeyringPort } from "../adapter/outbound/vapid-keyring.port";
import { toPushSubscriptionItem } from "./push-subscription-item";

/**
 * GET /me/push-subscriptions。自分の購読（有効・無効の両方）を
 * 登録日時の順で返す。宛先と鍵は含まない。
 */
export class ListPushSubscriptionsUseCase
  implements ListPushSubscriptionsInputPort
{
  constructor(
    private readonly unitOfWork: NotificationUnitOfWork,
    private readonly vapidKeyring: VapidKeyringPort,
  ) {}

  async execute(
    userId: UserId,
    sessionId: string,
  ): Promise<PushSubscriptionList> {
    const rows = await this.unitOfWork.run((ctx) =>
      ctx.subscriptions.listByUser(userId),
    );
    return {
      items: rows.map((row) =>
        toPushSubscriptionItem(row, this.vapidKeyring, sessionId),
      ),
    };
  }
}
