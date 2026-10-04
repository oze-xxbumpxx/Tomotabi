import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { TimelineItemKind } from "@tomotabi/contracts";
import { UserId } from "../../../common/domain/user-id";
import {
  paymentCancellations,
  payments,
  planEventCancellations,
} from "../../../infrastructure/database/schema/record";
import type {
  PlanEventCancellation,
  RecordsReadPort,
  RecordsTimelinePage,
  RecordsTimelineQuery,
  RecordTimelineAnchor,
  RecordTimelineRow,
} from "../adapter/outbound/records-read.port";
import type { Payment, PaymentCancellation } from "../domain/payment";
import {
  toPaymentCancellationDomain,
  toPaymentDomain,
} from "./drizzle-payment.repository";

type UnionRow = Readonly<{
  kind: string;
  id: string;
  // db.executeはdrizzleの型マッパーを通さないため、timestamptzは
  // pgの文字列表現（`2026-10-04 23:47:46.646439+00`）で返る。
  created_at: string;
  actor_id: string;
  plan_id: string | null;
  target_id: string;
}>;

/**
 * 支払い・支払いの取り消し・達成と予約・その取り消しを並べる
 * UNION ALL（設計書「記録の一覧とホーム」）。旅行のIDで絞るのは
 * 各部のWHERE。取り消しの行のIDは元の記録と同じになる
 * （取り消しの表の主キーは元の記録のID）。
 */
function timelineUnion(tripId: string): SQL {
  return sql`(
    SELECT e.event_kind AS kind, e.id AS id, e.created_at AS created_at,
           e.created_by AS actor_id, e.plan_id AS plan_id, e.id AS target_id
      FROM record.plan_events e
     WHERE e.trip_id = ${tripId}::uuid
    UNION ALL
    SELECT e.event_kind || '_cancellation', e.id, c.created_at, c.cancelled_by,
           e.plan_id, e.id
      FROM record.plan_event_cancellations c
      JOIN record.plan_events e
        ON e.trip_id = c.trip_id AND e.id = c.event_id
     WHERE c.trip_id = ${tripId}::uuid
    UNION ALL
    SELECT 'payment', p.id, p.created_at, p.created_by, p.plan_id, p.id
      FROM record.payments p
     WHERE p.trip_id = ${tripId}::uuid
    UNION ALL
    SELECT 'payment_cancellation', p.id, c.created_at, c.cancelled_by,
           p.plan_id, p.id
      FROM record.payment_cancellations c
      JOIN record.payments p
        ON p.trip_id = c.trip_id AND p.id = c.payment_id
     WHERE c.trip_id = ${tripId}::uuid
  )`;
}

function toTimelineRow(row: UnionRow, tripId: string): RecordTimelineRow {
  return {
    id: row.id,
    tripId,
    kind: row.kind as TimelineItemKind,
    createdAt: new Date(row.created_at),
    actorId: UserId.parse(row.actor_id),
    planId: row.plan_id,
    targetId: row.target_id,
  };
}

/**
 * 記録の一覧の読み取り（ホームのAPIも最近の記録に使う公開の照会）。
 * 一覧の行は「種類・ID・登録日時・誰が・予定のID・元の記録のID」だけを
 * UNION ALLで並べ、中身（支払い・取り消し）は種類ごとにまとめて読む。
 * UoWのトランザクション内のdbハンドルを受けて使う。
 */
export class PgRecordsRead implements RecordsReadPort {
  constructor(private readonly db: NodePgDatabase) {}

  async findAnchor(
    tripId: string,
    kind: TimelineItemKind,
    id: string,
  ): Promise<RecordTimelineAnchor | null> {
    // created_atをtextで取る。Date（ミリ秒）に変換すると同じミリ秒内の
    // 違う行を区別できず、ページの境目で行が抜け落ちる（findTripAnchorと同じ）。
    const result = await this.db.execute<{ created_at: string }>(sql`
      SELECT u.created_at::text AS created_at
        FROM ${timelineUnion(tripId)} u
       WHERE u.kind = ${kind} AND u.id = ${id}::uuid
       LIMIT 1
    `);
    const row = result.rows[0];
    return row === undefined ? null : { createdAt: row.created_at, kind, id };
  }

  async listTimeline(
    tripId: string,
    query: RecordsTimelineQuery,
  ): Promise<RecordsTimelinePage> {
    const conditions: SQL[] = [];
    if (query.type !== null) {
      conditions.push(
        sql`u.kind IN (${query.type}, ${`${query.type}_cancellation`})`,
      );
    }
    if (query.planId !== null) {
      conditions.push(sql`u.plan_id = ${query.planId}::uuid`);
    }
    if (query.recordId !== null) {
      conditions.push(sql`u.id = ${query.recordId}::uuid`);
    }
    if (query.after !== null) {
      // (created_at, kind, id)の複合キーで「より古い側」のページを取る。
      // createdAtはfindAnchorが::textで取ったDBの値なのでマイクロ秒の
      // 精度が保たれ、同じ日時の行がページの境目に来ても飛ばさない。
      conditions.push(
        sql`(u.created_at, u.kind, u.id) < (${query.after.createdAt}::timestamptz, ${query.after.kind}, ${query.after.id}::uuid)`,
      );
    }
    const where =
      conditions.length === 0 ? sql`TRUE` : sql.join(conditions, sql` AND `);
    const result = await this.db.execute<UnionRow>(sql`
      SELECT u.kind, u.id, u.created_at, u.actor_id, u.plan_id, u.target_id
        FROM ${timelineUnion(tripId)} u
       WHERE ${where}
       ORDER BY u.created_at DESC, u.kind DESC, u.id DESC
       LIMIT ${query.limit + 1}
    `);
    const items = result.rows
      .slice(0, query.limit)
      .map((row) => toTimelineRow(row, tripId));
    const last = items.at(-1);
    return {
      items,
      nextAnchor:
        result.rows.length > query.limit && last !== undefined
          ? { kind: last.kind, id: last.id }
          : null,
    };
  }

  async listPaymentsByIds(
    tripId: string,
    paymentIds: readonly string[],
  ): Promise<readonly Payment[]> {
    if (paymentIds.length === 0) {
      return [];
    }
    const rows = await this.db
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.tripId, tripId),
          inArray(payments.id, [...paymentIds]),
        ),
      );
    return rows.map(toPaymentDomain);
  }

  async listPaymentCancellationsByIds(
    tripId: string,
    paymentIds: readonly string[],
  ): Promise<readonly PaymentCancellation[]> {
    if (paymentIds.length === 0) {
      return [];
    }
    const rows = await this.db
      .select()
      .from(paymentCancellations)
      .where(
        and(
          eq(paymentCancellations.tripId, tripId),
          inArray(paymentCancellations.paymentId, [...paymentIds]),
        ),
      );
    return rows.map(toPaymentCancellationDomain);
  }

  async listPlanEventCancellationsByIds(
    tripId: string,
    eventIds: readonly string[],
  ): Promise<readonly PlanEventCancellation[]> {
    if (eventIds.length === 0) {
      return [];
    }
    const rows = await this.db
      .select()
      .from(planEventCancellations)
      .where(
        and(
          eq(planEventCancellations.tripId, tripId),
          inArray(planEventCancellations.eventId, [...eventIds]),
        ),
      );
    return rows.map((row) => ({
      eventId: row.eventId,
      tripId: row.tripId,
      cancelledBy: UserId.parse(row.cancelledBy),
      createdAt: row.createdAt,
    }));
  }
}
