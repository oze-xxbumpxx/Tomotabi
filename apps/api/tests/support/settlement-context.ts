import type { UnitOfWork } from "../../src/adapter/transaction/unit-of-work";
import type { ClaimHistory } from "../../src/modules/settlement/domain/fingerprint";
import type {
  ActiveClaim,
  ClaimKind,
} from "../../src/modules/settlement/domain/settlement-target";
import type { PaymentsReadPort } from "../../src/modules/settlement/adapter/outbound/payments-read.port";
import type {
  ExistingSettlement,
  LatestActiveSettlement,
  PreviewAnchor,
  PreviewItemRecord,
  PreviewPage,
  PreviewRecord,
  SettlementAnchor,
  SettlementCancellationRecord,
  SettlementItemRecord,
  SettlementListRow,
  SettlementPage,
  SettlementRecord,
  SettlementRepository,
} from "../../src/modules/settlement/adapter/outbound/settlement.repository";
import type { SettlementWorkContext } from "../../src/modules/settlement/adapter/outbound/settlement-work-context";
import { InMemoryFinanceContext, TRIP_ID } from "./finance-context";
import { ACTOR } from "./planning-context";

const BASE_TIME = new Date("2026-09-01T00:00:00.000Z");

export function previewItemOf(
  overrides: Partial<PreviewItemRecord> = {},
): PreviewItemRecord {
  return {
    paymentId: "77777777-7777-4777-8777-000000000001",
    kind: "BASE",
    contribution: 3500n as PreviewItemRecord["contribution"],
    baseSettlementId: null,
    expectedFingerprint:
      "0000000000000000000000000000000000000000000000000000000000000000",
    expectedCancelled: false,
    ...overrides,
  };
}

/**
 * 確認・精算まわりのUseCase試験用のインメモリ文脈。支払いの文脈に
 * paymentsReadとsettlementsのポートを足したもの（本番の
 * PgFinanceUnitOfWorkと同じ広さ）。
 */
export class InMemorySettlementContext
  extends InMemoryFinanceContext
  implements SettlementWorkContext
{
  readonly previewRows = new Map<string, PreviewRecord>();
  readonly previewItemRows = new Map<string, PreviewItemRecord[]>();
  readonly activeClaimRows = new Map<string, ActiveClaim>();
  readonly claimHistoryRows = new Map<string, ClaimHistory>();
  readonly settlementRows = new Map<string, ExistingSettlement>();
  readonly settlementRecordRows = new Map<string, SettlementRecord>();
  readonly settlementItemRows = new Map<string, SettlementItemRecord[]>();
  readonly settlementCancellationRows = new Map<
    string,
    SettlementCancellationRecord
  >();
  private nextPreviewId = 0;

  readonly paymentsRead: PaymentsReadPort = {
    listInTrip: (tripId) => {
      this.calls.push("paymentsRead.listInTrip");
      return Promise.resolve(
        [...this.paymentRows.values()].filter(
          (payment) => payment.tripId === tripId,
        ),
      );
    },
    listCancellationsInTrip: (tripId) => {
      this.calls.push("paymentsRead.listCancellationsInTrip");
      return Promise.resolve(
        [...this.cancellationRows.values()].filter(
          (cancellation) => cancellation.tripId === tripId,
        ),
      );
    },
  };

  readonly settlements: SettlementRepository = {
    insertPreview: (preview) => {
      this.calls.push("settlements.insertPreview");
      const stored: PreviewRecord = {
        ...preview,
        id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(++this.nextPreviewId).padStart(12, "0")}`,
        createdAt: BASE_TIME,
      };
      this.previewRows.set(stored.id, stored);
      return Promise.resolve(stored);
    },
    insertPreviewItems: (previewId, _tripId, items) => {
      this.calls.push("settlements.insertPreviewItems");
      this.previewItemRows.set(
        previewId,
        items.map((item) => ({ ...item })),
      );
      return Promise.resolve();
    },
    findPreviewInTrip: (tripId, previewId) => {
      this.calls.push("settlements.findPreviewInTrip");
      const preview = this.previewRows.get(previewId);
      return Promise.resolve(
        preview === undefined || preview.tripId !== tripId ? null : preview,
      );
    },
    listPreviewItems: (_tripId, previewIds) => {
      this.calls.push("settlements.listPreviewItems");
      const grouped = new Map<string, readonly PreviewItemRecord[]>();
      for (const previewId of previewIds) {
        grouped.set(
          previewId,
          this.previewItemRows.get(previewId) ?? [],
        );
      }
      return Promise.resolve(grouped);
    },
    findSettlementForPreview: (_tripId, previewId) => {
      this.calls.push("settlements.findSettlementForPreview");
      return Promise.resolve(this.settlementRows.get(previewId) ?? null);
    },
    findPreviewAnchor: (tripId, createdBy, previewId) => {
      this.calls.push("settlements.findPreviewAnchor");
      const preview = this.previewRows.get(previewId);
      const anchor: PreviewAnchor | null =
        preview === undefined ||
        preview.tripId !== tripId ||
        preview.createdBy !== createdBy
          ? null
          : { createdAt: preview.createdAt.toISOString(), id: previewId };
      return Promise.resolve(anchor);
    },
    listPendingPreviews: (tripId, createdBy, after, limit) => {
      this.calls.push("settlements.listPendingPreviews");
      const settled = new Set(this.settlementRows.keys());
      let rows = [...this.previewRows.values()].filter(
        (preview) =>
          preview.tripId === tripId &&
          preview.createdBy === createdBy &&
          !settled.has(preview.id),
      );
      if (after !== null) {
        rows = rows.filter(
          (preview) =>
            preview.createdAt.toISOString() < after.createdAt ||
            (preview.createdAt.toISOString() === after.createdAt &&
              preview.id < after.id),
        );
      }
      rows.sort(
        (a, b) =>
          b.createdAt.getTime() - a.createdAt.getTime() ||
          (a.id < b.id ? 1 : -1),
      );
      const page: PreviewPage = {
        items: rows.slice(0, limit),
        nextCursorId:
          rows.length > limit ? rows[limit - 1]!.id : null,
      };
      return Promise.resolve(page);
    },
    listActiveClaims: (tripId) => {
      this.calls.push("settlements.listActiveClaims");
      void tripId;
      return Promise.resolve([...this.activeClaimRows.values()]);
    },
    claimHistories: (_tripId, paymentIds) => {
      this.calls.push("settlements.claimHistories");
      const result = new Map<string, ClaimHistory>();
      for (const paymentId of paymentIds) {
        const history = this.claimHistoryRows.get(paymentId);
        if (history !== undefined) {
          result.set(paymentId, history);
        }
      }
      return Promise.resolve(result);
    },
    findSettlementInTrip: (tripId, settlementId) => {
      this.calls.push("settlements.findSettlementInTrip");
      const settlement = this.settlementRecordRows.get(settlementId);
      return Promise.resolve(
        settlement === undefined || settlement.tripId !== tripId
          ? null
          : settlement,
      );
    },
    findSettlementCancellation: (tripId, settlementId) => {
      this.calls.push("settlements.findSettlementCancellation");
      const cancellation = this.settlementCancellationRows.get(settlementId);
      return Promise.resolve(
        cancellation === undefined || cancellation.tripId !== tripId
          ? null
          : cancellation,
      );
    },
    findSettlementAnchor: (tripId, settlementId) => {
      this.calls.push("settlements.findSettlementAnchor");
      const settlement = this.settlementRecordRows.get(settlementId);
      const anchor: SettlementAnchor | null =
        settlement === undefined || settlement.tripId !== tripId
          ? null
          : { sequence: settlement.sequence };
      return Promise.resolve(anchor);
    },
    listSettlements: (tripId, after, limit) => {
      this.calls.push("settlements.listSettlements");
      let rows = [...this.settlementRecordRows.values()].filter(
        (settlement) => settlement.tripId === tripId,
      );
      if (after !== null) {
        rows = rows.filter(
          (settlement) => settlement.sequence < after.sequence,
        );
      }
      rows.sort((a, b) => b.sequence - a.sequence);
      const items: SettlementListRow[] = rows.slice(0, limit).map((row) => ({
        ...row,
        cancellation: this.settlementCancellationRows.get(row.id) ?? null,
      }));
      const last = items.at(-1);
      const page: SettlementPage = {
        items,
        nextCursorId:
          rows.length > limit && last !== undefined ? last.id : null,
      };
      return Promise.resolve(page);
    },
    listSettlementItems: (_tripId, settlementIds) => {
      this.calls.push("settlements.listSettlementItems");
      const grouped = new Map<string, readonly SettlementItemRecord[]>();
      for (const settlementId of settlementIds) {
        grouped.set(
          settlementId,
          this.settlementItemRows.get(settlementId) ?? [],
        );
      }
      return Promise.resolve(grouped);
    },
    findLatestActiveSettlement: (tripId) => {
      this.calls.push("settlements.findLatestActiveSettlement");
      let latest: LatestActiveSettlement | null = null;
      for (const settlement of this.settlementRecordRows.values()) {
        if (
          settlement.tripId !== tripId ||
          this.settlementCancellationRows.has(settlement.id)
        ) {
          continue;
        }
        if (latest === null || settlement.sequence > latest.sequence) {
          latest = { id: settlement.id, sequence: settlement.sequence };
        }
      }
      return Promise.resolve(latest);
    },
    insertSettlement: (settlement) => {
      this.calls.push("settlements.insertSettlement");
      const stored: SettlementRecord = {
        ...settlement,
        id: `bbbbbbbb-bbbb-4bbb-8bbb-${String(this.settlementRecordRows.size + 1).padStart(12, "0")}`,
        createdAt: BASE_TIME,
      };
      this.settlementRecordRows.set(stored.id, stored);
      // 確認と精算は UNIQUE preview_id で 1 対 1（完了の検証が見る行）。
      this.settlementRows.set(stored.previewId, {
        id: stored.id,
        cancelled: false,
      });
      return Promise.resolve(stored);
    },
    insertSettlementItems: (settlementId, _tripId, _previewId, items) => {
      this.calls.push("settlements.insertSettlementItems");
      this.settlementItemRows.set(
        settlementId,
        items.map((item) => ({ ...item })),
      );
      return Promise.resolve();
    },
    insertActiveClaims: (_tripId, settlementId, items) => {
      this.calls.push("settlements.insertActiveClaims");
      for (const item of items) {
        this.activeClaimRows.set(`${item.paymentId}|${item.kind}`, {
          paymentId: item.paymentId,
          kind: item.kind,
          settlementId,
        });
      }
      return Promise.resolve();
    },
    insertSettlementCancellation: (cancellation) => {
      this.calls.push("settlements.insertSettlementCancellation");
      const stored: SettlementCancellationRecord = {
        ...cancellation,
        createdAt: BASE_TIME,
      };
      this.settlementCancellationRows.set(stored.settlementId, stored);
      // 確認から見える精算の「取り消し済み」も同時に立てる（完了の検証と
      // 取り消しの存在を表す previewId→settlement の行の整合を保つ）。
      for (const [previewId, entry] of this.settlementRows) {
        if (entry.id === stored.settlementId) {
          this.settlementRows.set(previewId, { ...entry, cancelled: true });
        }
      }
      return Promise.resolve(stored);
    },
    deleteActiveClaimsForSettlement: (_tripId, settlementId) => {
      this.calls.push("settlements.deleteActiveClaimsForSettlement");
      for (const [key, claim] of this.activeClaimRows) {
        if (claim.settlementId === settlementId) {
          this.activeClaimRows.delete(key);
        }
      }
      return Promise.resolve();
    },
  };

  /** 支払いに占有を置く（kindで識別。戻しの試験用）。 */
  seedClaim(paymentId: string, kind: ClaimKind, settlementId: string): void {
    this.activeClaimRows.set(`${paymentId}|${kind}`, {
      paymentId,
      kind,
      settlementId,
    });
  }

  seedClaimHistory(paymentId: string, history: ClaimHistory): void {
    this.claimHistoryRows.set(paymentId, history);
  }

  seedSettlementForPreview(
    previewId: string,
    settlement: ExistingSettlement,
    overrides: Partial<
      Pick<SettlementRecord, "sequence" | "createdBy" | "signedTotal">
    > = {},
  ): void {
    this.settlementRows.set(previewId, settlement);
    const preview = this.previewRows.get(previewId);
    const record: SettlementRecord = {
      id: settlement.id,
      tripId: preview?.tripId ?? TRIP_ID,
      previewId,
      sequence: overrides.sequence ?? 1,
      createdBy: overrides.createdBy ?? ACTOR,
      createdAt: BASE_TIME,
      signedTotal:
        overrides.signedTotal ??
        preview?.signedTotal ??
        (0n as SettlementRecord["signedTotal"]),
      completionKind: "transfer_completed",
    };
    this.settlementRecordRows.set(record.id, record);
    if (settlement.cancelled) {
      this.settlementCancellationRows.set(record.id, {
        settlementId: record.id,
        tripId: record.tripId,
        cancelledBy: ACTOR,
        createdAt: BASE_TIME,
      });
    }
  }

  /**
   * 精算を直接登録する（取り消し・一覧の試験用）。previewId は
   * 確認の行が無ければ適当な値でよい（精算の行の preview_id は
   * 検証に使われない）。
   */
  seedSettlement(
    overrides: Partial<SettlementRecord> & { previewId?: string } = {},
  ): SettlementRecord {
    const id =
      overrides.id ??
      `bbbbbbbb-bbbb-4bbb-8bbb-${String(this.settlementRecordRows.size + 1).padStart(12, "0")}`;
    const tripId = overrides.tripId ?? TRIP_ID;
    const record: SettlementRecord = {
      id,
      tripId,
      previewId:
        overrides.previewId ??
        `aaaaaaaa-aaaa-4aaa-8aaa-${String(900 + this.settlementRecordRows.size).padStart(12, "0")}`,
      sequence: overrides.sequence ?? 1,
      createdBy: overrides.createdBy ?? ACTOR,
      createdAt: overrides.createdAt ?? BASE_TIME,
      signedTotal:
        overrides.signedTotal ?? (3500n as SettlementRecord["signedTotal"]),
      completionKind: overrides.completionKind ?? "transfer_completed",
    };
    this.settlementRecordRows.set(record.id, record);
    return record;
  }

  seedSettlementItems(
    settlementId: string,
    items: readonly SettlementItemRecord[],
  ): void {
    this.settlementItemRows.set(
      settlementId,
      items.map((item) => ({ ...item })),
    );
  }

  seedSettlementCancellation(
    settlementId: string,
    overrides: Partial<SettlementCancellationRecord> = {},
  ): void {
    const settlement = this.settlementRecordRows.get(settlementId);
    const record: SettlementCancellationRecord = {
      settlementId,
      tripId: overrides.tripId ?? settlement?.tripId ?? TRIP_ID,
      cancelledBy: overrides.cancelledBy ?? ACTOR,
      createdAt: overrides.createdAt ?? BASE_TIME,
    };
    this.settlementCancellationRows.set(settlementId, record);
    for (const [previewId, entry] of this.settlementRows) {
      if (entry.id === settlementId) {
        this.settlementRows.set(previewId, { ...entry, cancelled: true });
      }
    }
  }
}

export function inMemorySettlementUnitOfWork(
  ctx: InMemorySettlementContext,
): UnitOfWork<SettlementWorkContext> {
  return { run: (work) => work(ctx) };
}
