import {
  and,
  asc,
  desc,
  eq,
  inArray,
  notExists,
  sql,
} from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { UserId } from "../../../common/domain/user-id";
import type { SignedYen } from "../../../common/domain/yen";
import { payments } from "../../../infrastructure/database/schema/record";
import {
  activeClaims,
  previewItems,
  previews,
  settlementCancellations,
  settlementItems,
  settlements,
} from "../../../infrastructure/database/schema/settlement";
import type { ClaimHistory } from "../domain/fingerprint";
import type { ActiveClaim, ClaimKind } from "../domain/settlement-target";
import type {
  ExistingSettlement,
  NewPreview,
  NewPreviewItem,
  PreviewAnchor,
  PreviewItemRecord,
  PreviewPage,
  PreviewRecord,
  SettlementRepository,
} from "../adapter/outbound/settlement.repository";

type PreviewRow = typeof previews.$inferSelect;
type PreviewItemRow = typeof previewItems.$inferSelect;

function toPreviewRecord(row: PreviewRow): PreviewRecord {
  return {
    id: row.id,
    tripId: row.tripId,
    createdBy: row.createdBy as UserId,
    createdAt: row.createdAt,
    signedTotal: row.signedTotalYen as SignedYen,
  };
}

function toPreviewItemRecord(row: PreviewItemRow): PreviewItemRecord {
  return {
    paymentId: row.paymentId,
    kind: row.kind as ClaimKind,
    contribution: row.contributionYen as SignedYen,
    baseSettlementId: row.baseSettlementId,
    expectedFingerprint: row.expectedClaimFingerprint,
    expectedCancelled: row.expectedCancelled,
  };
}

/**
 * settlement スキーマの Repository。確認・精算・取り消しは追記のみ、
 * 占有（active_claims）は補助状態。UoW のトランザクション内の db
 * ハンドルを受けて使う。
 */
export class DrizzleSettlementRepository implements SettlementRepository {
  constructor(private readonly db: NodePgDatabase) {}

  async insertPreview(preview: NewPreview): Promise<PreviewRecord> {
    const rows = await this.db
      .insert(previews)
      .values({
        tripId: preview.tripId,
        createdBy: preview.createdBy,
        signedTotalYen: preview.signedTotal,
      })
      .returning();
    return toPreviewRecord(rows[0]!);
  }

  async insertPreviewItems(
    previewId: string,
    tripId: string,
    items: readonly NewPreviewItem[],
  ): Promise<void> {
    await this.db.insert(previewItems).values(
      items.map((item) => ({
        previewId,
        tripId,
        paymentId: item.paymentId,
        kind: item.kind,
        contributionYen: item.contribution,
        baseSettlementId: item.baseSettlementId,
        expectedClaimFingerprint: item.expectedFingerprint,
        expectedCancelled: item.expectedCancelled,
      })),
    );
  }

  async findPreviewInTrip(
    tripId: string,
    previewId: string,
  ): Promise<PreviewRecord | null> {
    const rows = await this.db
      .select()
      .from(previews)
      .where(and(eq(previews.tripId, tripId), eq(previews.id, previewId)));
    const row = rows[0];
    return row === undefined ? null : toPreviewRecord(row);
  }

  async listPreviewItems(
    tripId: string,
    previewId: string,
  ): Promise<readonly PreviewItemRecord[]> {
    // 明細は支払いの記録順で返す（確認を作った時点の対象の並びを
    // そのまま再現する。preview_items 自体に順序の列は持たない）。
    const rows = await this.db
      .select({ item: previewItems })
      .from(previewItems)
      .innerJoin(
        payments,
        and(
          eq(payments.tripId, previewItems.tripId),
          eq(payments.id, previewItems.paymentId),
        ),
      )
      .where(
        and(
          eq(previewItems.tripId, tripId),
          eq(previewItems.previewId, previewId),
        ),
      )
      .orderBy(asc(payments.createdAt), asc(payments.id));
    return rows.map((row) => toPreviewItemRecord(row.item));
  }

  async findSettlementForPreview(
    tripId: string,
    previewId: string,
  ): Promise<ExistingSettlement | null> {
    const rows = await this.db
      .select({
        id: settlements.id,
        cancelled: sql<boolean>`${settlementCancellations.settlementId} IS NOT NULL`,
      })
      .from(settlements)
      .leftJoin(
        settlementCancellations,
        and(
          eq(settlementCancellations.tripId, settlements.tripId),
          eq(settlementCancellations.settlementId, settlements.id),
        ),
      )
      .where(
        and(
          eq(settlements.tripId, tripId),
          eq(settlements.previewId, previewId),
        ),
      );
    const row = rows[0];
    return row === undefined ? null : { id: row.id, cancelled: row.cancelled };
  }

  async findPreviewAnchor(
    tripId: string,
    createdBy: UserId,
    previewId: string,
  ): Promise<PreviewAnchor | null> {
    // created_at を text で取る。Date（ミリ秒）に変換すると同じミリ秒内の
    // 違う行を区別できず、ページの境目で確認が抜け落ちる（trip の一覧と同じ）。
    const rows = await this.db
      .select({ createdAt: sql<string>`${previews.createdAt}::text` })
      .from(previews)
      .where(
        and(
          eq(previews.tripId, tripId),
          eq(previews.createdBy, createdBy),
          eq(previews.id, previewId),
        ),
      );
    const row = rows[0];
    return row === undefined
      ? null
      : { createdAt: row.createdAt, id: previewId };
  }

  async listPendingPreviews(
    tripId: string,
    createdBy: UserId,
    after: PreviewAnchor | null,
    limit: number,
  ): Promise<PreviewPage> {
    // 未完了 = その確認に紐づく精算の行がまだ無い（精算は取り消されても
    // 行が残るので、取り消し済みの確認もここには出ない）。
    const unsettled = notExists(
      this.db
        .select({ _: sql`1` })
        .from(settlements)
        .where(
          and(
            eq(settlements.tripId, previews.tripId),
            eq(settlements.previewId, previews.id),
          ),
        ),
    );
    const conditions = [
      eq(previews.tripId, tripId),
      eq(previews.createdBy, createdBy),
      unsettled,
    ];
    if (after !== null) {
      // (created_at, id) の複合キーで「より古い側」のページを取る。
      conditions.push(
        sql`(${previews.createdAt}, ${previews.id}) < (${after.createdAt}::timestamptz, ${after.id}::uuid)`,
      );
    }
    const rows = await this.db
      .select()
      .from(previews)
      .where(and(...conditions))
      .orderBy(desc(previews.createdAt), desc(previews.id))
      .limit(limit + 1);
    const items = rows.slice(0, limit).map(toPreviewRecord);
    const last = items.at(-1);
    return {
      items,
      nextCursorId:
        rows.length > limit && last !== undefined ? last.id : null,
    };
  }

  async listActiveClaims(tripId: string): Promise<readonly ActiveClaim[]> {
    const rows = await this.db
      .select({
        paymentId: activeClaims.paymentId,
        kind: activeClaims.kind,
        settlementId: activeClaims.settlementId,
      })
      .from(activeClaims)
      .where(eq(activeClaims.tripId, tripId));
    return rows.map((row) => ({
      paymentId: row.paymentId,
      kind: row.kind as ClaimKind,
      settlementId: row.settlementId,
    }));
  }

  async claimHistories(
    tripId: string,
    paymentIds: readonly string[],
  ): Promise<ReadonlyMap<string, ClaimHistory>> {
    const histories = new Map<string, ClaimHistory>();
    if (paymentIds.length === 0) {
      return histories;
    }
    const [activeRows, itemRows, cancelledRows] = await Promise.all([
      this.db
        .select({
          paymentId: activeClaims.paymentId,
          kind: activeClaims.kind,
          settlementId: activeClaims.settlementId,
        })
        .from(activeClaims)
        .where(
          and(
            eq(activeClaims.tripId, tripId),
            inArray(activeClaims.paymentId, [...paymentIds]),
          ),
        ),
      this.db
        .select({
          paymentId: settlementItems.paymentId,
          settlementId: settlementItems.settlementId,
          kind: settlementItems.kind,
        })
        .from(settlementItems)
        .where(
          and(
            eq(settlementItems.tripId, tripId),
            inArray(settlementItems.paymentId, [...paymentIds]),
          ),
        ),
      // 精算の取り消しは明細行経由で支払いに辿る（cancellations 自体は
      // payment_id を持たない）。
      this.db
        .select({
          paymentId: settlementItems.paymentId,
          settlementId: settlementItems.settlementId,
        })
        .from(settlementItems)
        .innerJoin(
          settlementCancellations,
          and(
            eq(settlementCancellations.tripId, settlementItems.tripId),
            eq(
              settlementCancellations.settlementId,
              settlementItems.settlementId,
            ),
          ),
        )
        .where(
          and(
            eq(settlementItems.tripId, tripId),
            inArray(settlementItems.paymentId, [...paymentIds]),
          ),
        ),
    ]);

    const base = (paymentId: string): ClaimHistory =>
      histories.get(paymentId) ?? {
        activeClaims: {},
        items: [],
        cancelledSettlementIds: [],
      };
    for (const row of activeRows) {
      const history = base(row.paymentId);
      histories.set(row.paymentId, {
        ...history,
        activeClaims: {
          ...history.activeClaims,
          [row.kind as ClaimKind]: row.settlementId,
        },
      });
    }
    for (const row of itemRows) {
      const history = base(row.paymentId);
      histories.set(row.paymentId, {
        ...history,
        items: [
          ...history.items,
          { settlementId: row.settlementId, kind: row.kind as ClaimKind },
        ],
      });
    }
    for (const row of cancelledRows) {
      const history = base(row.paymentId);
      if (!history.cancelledSettlementIds.includes(row.settlementId)) {
        histories.set(row.paymentId, {
          ...history,
          cancelledSettlementIds: [
            ...history.cancelledSettlementIds,
            row.settlementId,
          ],
        });
      }
    }
    return histories;
  }
}
