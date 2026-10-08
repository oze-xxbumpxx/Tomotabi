import type { Clock } from "../../../adapter/clock/clock";
import type { UserId } from "../../../common/domain/user-id";
import type { DisablePushSubscriptionInputPort } from "../adapter/inbound/disable-push-subscription.input-port";
import type { NotificationUnitOfWork } from "../adapter/outbound/push-subscription.repository";

/**
 * DELETE /me/push-subscriptions/{id}。自分の購読だけを無効にする。
 * 停止も登録と同じ利用者行をロックしてから行う（N-06）。
 * 他人の・無い・既に無効のIDも同じく成功で返し、情報を漏らさない。
 */
export class DisablePushSubscriptionUseCase
  implements DisablePushSubscriptionInputPort
{
  constructor(
    private readonly unitOfWork: NotificationUnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(userId: UserId, id: string): Promise<void> {
    const now = this.clock.now();
    await this.unitOfWork.run(async (ctx) => {
      await ctx.subscriptions.lockOwner(userId);
      await ctx.subscriptions.disable(userId, id, now);
    });
  }
}
