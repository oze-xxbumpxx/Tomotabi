import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import type { UnitOfWork } from "../../../adapter/transaction/unit-of-work";
import type { NotificationWorkContext } from "../adapter/outbound/push-subscription.repository";
import { DrizzlePushSubscriptionRepository } from "./drizzle-push-subscription.repository";

/**
 * 購読の登録・停止・一覧を1トランザクションに束ねる
 * （設計書「購読の登録」「UnitOfWorkの文脈」）。トランザクションの
 * 始めにlock_timeoutを3秒にする（待ちきれない・デッドロックは
 * 巻き戻して503。UseCaseでは再試行しない）。
 * 文脈には型付きのRepositoryだけを渡し、生の接続は渡さない。
 */
export class PgNotificationUnitOfWork
  implements UnitOfWork<NotificationWorkContext>
{
  constructor(private readonly pool: Pool) {}

  async run<T>(
    work: (ctx: NotificationWorkContext) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    let released = false;
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL lock_timeout = '3s'");
      const db = drizzle(client);
      const result = await work({
        subscriptions: new DrizzlePushSubscriptionRepository(db),
      });
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        // ROLLBACK自体が失敗した接続（切断など）は壊れているため、
        // プールに戻さず捨てる。
        client.release(
          rollbackError instanceof Error
            ? rollbackError
            : new Error("ROLLBACK に失敗しました", { cause: rollbackError }),
        );
        released = true;
        throw error;
      }
      throw error;
    } finally {
      if (!released) {
        client.release();
      }
    }
  }
}
