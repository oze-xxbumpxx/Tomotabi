import type { UnitOfWork } from "../../src/adapter/transaction/unit-of-work";
import type { ClaimHistory } from "../../src/modules/settlement/domain/fingerprint";
import type {
  ActiveClaim,
  ClaimKind,
} from "../../src/modules/settlement/domain/settlement-target";
import type { PaymentsReadPort } from "../../src/modules/settlement/adapter/outbound/payments-read.port";
import type {
  ExistingSettlement,
  PreviewAnchor,
  PreviewItemRecord,
  PreviewPage,
  PreviewRecord,
  SettlementRepository,
} from "../../src/modules/settlement/adapter/outbound/settlement.repository";
import type { SettlementWorkContext } from "../../src/modules/settlement/adapter/outbound/settlement-work-context";
import { InMemoryFinanceContext } from "./finance-context";

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
  ): void {
    this.settlementRows.set(previewId, settlement);
  }
}

export function inMemorySettlementUnitOfWork(
  ctx: InMemorySettlementContext,
): UnitOfWork<SettlementWorkContext> {
  return { run: (work) => work(ctx) };
}
