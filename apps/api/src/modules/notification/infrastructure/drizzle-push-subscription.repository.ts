import { randomUUID } from "node:crypto";
import {
  and,
  asc,
  eq,
  exists,
  getTableColumns,
  gt,
  isNotNull,
  lte,
  notExists,
  sql,
} from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { UserId } from "../../../common/domain/user-id";
import {
  sessions,
  users,
} from "../../../infrastructure/database/schema/identity";
import {
  closedPushSessions,
  pushSubscriptions,
} from "../../../infrastructure/database/schema/notification";
import type {
  NewPushSubscription,
  PushSubscriptionRepository,
  PushSubscriptionRow,
  PushSubscriptionUpdate,
} from "../adapter/outbound/push-subscription.repository";

const toRow = (
  row: typeof pushSubscriptions.$inferSelect,
): PushSubscriptionRow => ({
  id: row.id,
  userId: row.userId as UserId,
  endpoint: row.endpoint,
  endpointHash: row.endpointHash,
  p256dh: row.p256dh,
  authSecret: row.authSecret,
  expirationTime: row.expirationTime,
  registrationSessionId: row.registrationSessionId,
  deviceLabel: row.deviceLabel,
  vapidKeyId: row.vapidKeyId,
  enabled: row.enabled,
  revision: row.revision,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export class DrizzlePushSubscriptionRepository
  implements PushSubscriptionRepository
{
  constructor(private readonly db: NodePgDatabase) {}

  async lockOwner(userId: UserId): Promise<void> {
    const rows = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      .for("update");
    if (rows.length === 0) {
      // 認証済みの利用者にusers行が無いのはデータの不整合。
      throw new Error("identity.users row is missing for a signed-in user");
    }
  }

  async isSessionClosed(sessionId: string): Promise<boolean> {
    const rows = await this.db
      .select({ sessionId: closedPushSessions.sessionId })
      .from(closedPushSessions)
      .where(eq(closedPushSessions.sessionId, sessionId))
      .limit(1);
    return rows.length > 0;
  }

  async closeSession(
    sessionId: string,
    userId: UserId,
    closedAt: Date,
  ): Promise<void> {
    await this.db
      .insert(closedPushSessions)
      .values({ sessionId, userId, closedAt })
      .onConflictDoNothing();
  }

  async disableByRegistrationSession(
    userId: UserId,
    sessionId: string,
    now: Date,
  ): Promise<void> {
    await this.db
      .update(pushSubscriptions)
      .set({
        enabled: false,
        revision: sql`${pushSubscriptions.revision} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(pushSubscriptions.userId, userId),
          eq(pushSubscriptions.registrationSessionId, sessionId),
          eq(pushSubscriptions.enabled, true),
        ),
      );
  }

  async disableExpired(userId: UserId, now: Date): Promise<number> {
    const rows = await this.db
      .update(pushSubscriptions)
      .set({
        enabled: false,
        revision: sql`${pushSubscriptions.revision} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(pushSubscriptions.userId, userId),
          eq(pushSubscriptions.enabled, true),
          isNotNull(pushSubscriptions.expirationTime),
          lte(pushSubscriptions.expirationTime, now),
        ),
      )
      .returning({ id: pushSubscriptions.id });
    return rows.length;
  }

  async disableExpiredSessions(
    userId: UserId,
    now: Date,
  ): Promise<number> {
    const rows = await this.db
      .update(pushSubscriptions)
      .set({
        enabled: false,
        revision: sql`${pushSubscriptions.revision} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(pushSubscriptions.userId, userId),
          eq(pushSubscriptions.enabled, true),
          // 登録したセッションが残っていて期限が来ていない、以外。
          // 送る相手の条件と同じ判定（sessions.id::textで比べる）。
          notExists(
            this.db
              .select({ _: sql`1` })
              .from(sessions)
              .where(
                and(
                  sql`${sessions.id}::text = ${pushSubscriptions.registrationSessionId}`,
                  gt(sessions.expiresAt, now),
                ),
              ),
          ),
        ),
      )
      .returning({ id: pushSubscriptions.id });
    return rows.length;
  }

  async findByEndpointHash(
    endpointHash: Buffer,
  ): Promise<PushSubscriptionRow | null> {
    const rows = await this.db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpointHash, endpointHash))
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : toRow(row);
  }

  async countEnabled(userId: UserId): Promise<number> {
    const rows = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.userId, userId),
          eq(pushSubscriptions.enabled, true),
        ),
      );
    return rows[0]?.count ?? 0;
  }

  async insert(
    input: NewPushSubscription,
    now: Date,
  ): Promise<PushSubscriptionRow> {
    const rows = await this.db
      .insert(pushSubscriptions)
      .values({
        id: randomUUID(),
        userId: input.userId,
        endpoint: input.endpoint,
        endpointHash: input.endpointHash,
        p256dh: input.p256dh,
        authSecret: input.authSecret,
        expirationTime: input.expirationTime,
        registrationSessionId: input.registrationSessionId,
        deviceLabel: input.deviceLabel,
        vapidKeyId: input.vapidKeyId,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    const row = rows[0];
    if (row === undefined) {
      throw new Error("insert of push_subscriptions returned no row");
    }
    return toRow(row);
  }

  async update(
    id: string,
    userId: UserId,
    input: PushSubscriptionUpdate,
    now: Date,
  ): Promise<PushSubscriptionRow | null> {
    const rows = await this.db
      .update(pushSubscriptions)
      .set({
        endpoint: input.endpoint,
        p256dh: input.p256dh,
        authSecret: input.authSecret,
        expirationTime: input.expirationTime,
        registrationSessionId: input.registrationSessionId,
        deviceLabel: input.deviceLabel,
        vapidKeyId: input.vapidKeyId,
        enabled: true,
        revision: sql`${pushSubscriptions.revision} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(pushSubscriptions.id, id),
          eq(pushSubscriptions.userId, userId),
        ),
      )
      .returning();
    const row = rows[0];
    return row === undefined ? null : toRow(row);
  }

  async takeOver(
    id: string,
    userId: UserId,
    input: PushSubscriptionUpdate,
    now: Date,
  ): Promise<PushSubscriptionRow | null> {
    const rows = await this.db
      .update(pushSubscriptions)
      .set({
        userId,
        endpoint: input.endpoint,
        p256dh: input.p256dh,
        authSecret: input.authSecret,
        expirationTime: input.expirationTime,
        registrationSessionId: input.registrationSessionId,
        deviceLabel: input.deviceLabel,
        vapidKeyId: input.vapidKeyId,
        enabled: true,
        revision: sql`${pushSubscriptions.revision} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(pushSubscriptions.id, id),
          eq(pushSubscriptions.enabled, false),
        ),
      )
      .returning();
    const row = rows[0];
    return row === undefined ? null : toRow(row);
  }

  async disable(userId: UserId, id: string, now: Date): Promise<void> {
    await this.db
      .update(pushSubscriptions)
      .set({
        enabled: false,
        revision: sql`${pushSubscriptions.revision} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(pushSubscriptions.id, id),
          eq(pushSubscriptions.userId, userId),
          eq(pushSubscriptions.enabled, true),
        ),
      );
  }

  async listByUser(userId: UserId): Promise<readonly PushSubscriptionRow[]> {
    // 登録したログインが消えた・期限切れの購読は届かないため、一覧では
    // 無効として返す（読み取りで行は書き換えない。判定は送る相手の
    // 条件と同じ）。
    const sessionAlive = exists(
      this.db
        .select({ _: sql`1` })
        .from(sessions)
        .where(
          and(
            sql`${sessions.id}::text = ${pushSubscriptions.registrationSessionId}`,
            gt(sessions.expiresAt, sql`now()`),
          ),
        ),
    );
    const rows = await this.db
      .select({
        ...getTableColumns(pushSubscriptions),
        enabled: sql<boolean>`${pushSubscriptions.enabled} and ${sessionAlive}`,
      })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId))
      .orderBy(asc(pushSubscriptions.createdAt), asc(pushSubscriptions.id));
    return rows.map(toRow);
  }
}
