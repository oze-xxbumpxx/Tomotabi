import { and, eq, ne, notExists, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool, PoolClient } from "pg";
import type { UserId } from "../../../common/domain/user-id";
import {
  allowedGoogleAccounts,
  users,
} from "../../../infrastructure/database/schema/identity";
import {
  closedPushSessions,
  pushSubscriptions,
} from "../../../infrastructure/database/schema/notification";
import {
  tripParticipants,
  trips,
} from "../../../infrastructure/database/schema/planning";
import type {
  DispatchContext,
  DispatchTarget,
  NotificationDispatchStore,
} from "../adapter/outbound/notification-dispatch-store";

/** 読み取り・無効化のトランザクションの上限（設計書「エラー処理」）。 */
const QUERY_TIMEOUT = "2s";

/**
 * 送る処理のDBの読み取り・無効化（設計書「送る処理」）。
 * notificationのinfrastructureがidentity・planningの表を読み取り専用で
 * 読む（ホームの読み取りと同じやり方）。statement_timeoutとlock_timeoutを
 * 2秒にしたトランザクションで行う。
 */
export class PgNotificationDispatchStore implements NotificationDispatchStore {
  constructor(private readonly pool: Pool) {}

  async readDispatchContext(input: Readonly<{
    tripId: string;
    actorUserId: UserId;
  }>): Promise<DispatchContext | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN READ ONLY");
      await client.query(`SET LOCAL statement_timeout = '${QUERY_TIMEOUT}'`);
      await client.query(`SET LOCAL lock_timeout = '${QUERY_TIMEOUT}'`);
      const db = drizzle(client);

      // 操作した人がその旅行の参加者のときだけ名前を返す
      // （参加者でない人の操作には通知を出さない）。
      const names = await db
        .select({ actorName: users.name, tripName: trips.name })
        .from(trips)
        .innerJoin(users, eq(users.id, input.actorUserId))
        .innerJoin(
          tripParticipants,
          and(
            eq(tripParticipants.tripId, input.tripId),
            eq(tripParticipants.userId, input.actorUserId),
          ),
        )
        .where(eq(trips.id, input.tripId));
      const nameRow = names[0];
      if (nameRow === undefined) {
        await client.query("COMMIT");
        return null;
      }

      const now = new Date();
      const targets = await db
        .select({
          subscriptionId: pushSubscriptions.id,
          userId: pushSubscriptions.userId,
          endpoint: pushSubscriptions.endpoint,
          p256dh: pushSubscriptions.p256dh,
          authSecret: pushSubscriptions.authSecret,
          vapidKeyId: pushSubscriptions.vapidKeyId,
          revision: pushSubscriptions.revision,
        })
        .from(pushSubscriptions)
        .innerJoin(
          tripParticipants,
          and(
            eq(tripParticipants.tripId, input.tripId),
            eq(tripParticipants.userId, pushSubscriptions.userId),
          ),
        )
        .innerJoin(
          allowedGoogleAccounts,
          and(
            eq(allowedGoogleAccounts.userId, pushSubscriptions.userId),
            eq(allowedGoogleAccounts.enabled, true),
          ),
        )
        .where(
          and(
            eq(pushSubscriptions.enabled, true),
            ne(pushSubscriptions.userId, input.actorUserId),
            // 期限が過ぎていない（無期限はnull）。
            sql`(${pushSubscriptions.expirationTime} IS NULL OR ${pushSubscriptions.expirationTime} > ${now.toISOString()}::timestamptz)`,
            notExists(
              db
                .select({ sessionId: closedPushSessions.sessionId })
                .from(closedPushSessions)
                .where(
                  eq(
                    closedPushSessions.sessionId,
                    pushSubscriptions.registrationSessionId,
                  ),
                ),
            ),
          ),
        );
      await client.query("COMMIT");
      return {
        actorName: nameRow.actorName,
        tripName: nameRow.tripName,
        targets: targets.map(
          (row): DispatchTarget => ({
            subscriptionId: row.subscriptionId,
            userId: row.userId as UserId,
            endpoint: row.endpoint,
            p256dh: row.p256dh,
            authSecret: row.authSecret,
            vapidKeyId: row.vapidKeyId,
            revision: row.revision,
          }),
        ),
      };
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async disableIfSameRevision(
    subscriptionId: string,
    revision: bigint,
    now: Date,
  ): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL statement_timeout = '${QUERY_TIMEOUT}'`);
      await client.query(`SET LOCAL lock_timeout = '${QUERY_TIMEOUT}'`);
      const db = drizzle(client);
      const updated = await db
        .update(pushSubscriptions)
        .set({
          enabled: false,
          revision: sql`${pushSubscriptions.revision} + 1`,
          updatedAt: now,
        })
        .where(
          and(
            eq(pushSubscriptions.id, subscriptionId),
            eq(pushSubscriptions.revision, revision),
          ),
        )
        .returning({ id: pushSubscriptions.id });
      await client.query("COMMIT");
      return updated.length === 1;
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }
}

async function rollbackQuietly(client: PoolClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {
    // ROLLBACK自体の失敗（切断など）は元の例外の報告を優先して握りつぶす。
  }
}
