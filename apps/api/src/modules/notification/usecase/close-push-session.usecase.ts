import type { Clock } from "../../../adapter/clock/clock";
import type { UserId } from "../../../common/domain/user-id";
import type { ClosePushSessionInputPort } from "../adapter/inbound/close-push-session.input-port";
import type { NotificationUnitOfWork } from "../adapter/outbound/push-subscription.repository";

/**
 * POST /api/auth/sign-out の手前で、そのセッションの通知を止める
 * （設計書「ログアウト」）。1トランザクションで、自分のusers行を
 * FOR UPDATEで取り、停止の記録を入れ（ON CONFLICT DO NOTHING）、
 * このセッションで登録した自分の購読だけを無効にする。
 * 登録・停止と同じ行のロックで直列にするため、ログアウトの直前に
 * 認証された遅い登録もCOMMITのあとに409で断る（F-61）。
 * DBの失敗はそのまま呼び出し側へ投げ、ログアウトさせない（F-62）。
 */
export class ClosePushSessionUseCase implements ClosePushSessionInputPort {
  constructor(
    private readonly unitOfWork: NotificationUnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(userId: UserId, sessionId: string): Promise<void> {
    const now = this.clock.now();
    await this.unitOfWork.run(async (ctx) => {
      const repo = ctx.subscriptions;
      await repo.lockOwner(userId);
      await repo.closeSession(sessionId, userId, now);
      await repo.disableByRegistrationSession(userId, sessionId, now);
    });
  }
}
