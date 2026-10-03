import { describe, expect, it } from "vitest";
import type { UnitOfWork } from "../../../src/adapter/transaction/unit-of-work";
import { PaymentYen, SignedYen } from "../../../src/common/domain/yen";
import type { IdempotencyKey } from "../../../src/common/http/idempotency-key";
import { COMPLETE_SETTLEMENT_OPERATION } from "../../../src/modules/settlement/adapter/inbound/complete-settlement.input-port";
import type { SettlementWorkContext } from "../../../src/modules/settlement/adapter/outbound/settlement-work-context";
import type { PreviewRecord } from "../../../src/modules/settlement/adapter/outbound/settlement.repository";
import {
  EMPTY_CLAIM_HISTORY,
  fingerprintOf,
} from "../../../src/modules/settlement/domain/fingerprint";
import { CompleteSettlementUseCase } from "../../../src/modules/settlement/usecase/complete-settlement.usecase";
import { Payment } from "../../../src/modules/record/domain/payment";
import {
  ACTOR,
  KEY,
  PARTNER,
  RecordingWriteLog,
} from "../../support/planning-context";
import { TRIP_ID } from "../../support/finance-context";
import {
  InMemorySettlementContext,
  inMemorySettlementUnitOfWork,
  previewItemOf,
} from "../../support/settlement-context";

const PREVIEW_ID = "aaaaaaaa-aaaa-4aaa-8aaa-000000000001";
const PAYMENT_ID = "77777777-7777-4777-8777-000000000001";
const PAYMENT2_ID = "77777777-7777-4777-8777-000000000002";
const SETTLEMENT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-000000000001";
const OTHER_SETTLEMENT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-000000000002";

const EMPTY_FINGERPRINT = fingerprintOf(EMPTY_CLAIM_HISTORY);

function setup() {
  const ctx = new InMemorySettlementContext();
  const uow = inMemorySettlementUnitOfWork(ctx);
  const writeLog = new RecordingWriteLog();
  return { ctx, uow, writeLog };
}

function createUsecase(
  uow: UnitOfWork<SettlementWorkContext>,
  writeLog: RecordingWriteLog,
) {
  return new CompleteSettlementUseCase(uow, writeLog);
}

function completeInput(
  overrides: Partial<{
    key: IdempotencyKey;
    requestHash: string;
    userId: string;
    tripId: string;
    previewId: string;
    completionKind: "transfer_completed" | "no_transfer_required";
    acknowledgedCancellationPaymentIds: string[];
  }> = {},
) {
  return {
    userId: ACTOR,
    tripId: TRIP_ID,
    key: KEY,
    requestHash: "hash-c",
    previewId: PREVIEW_ID,
    completionKind: "transfer_completed" as const,
    acknowledgedCancellationPaymentIds: [] as string[],
    ...overrides,
  };
}

function storedPayment(overrides: Partial<Payment> = {}): Payment {
  const created = Payment.create({
    tripId: TRIP_ID,
    planId: null,
    amount: PaymentYen.parse("7001"),
    payerSlot: 0,
    slot0Percent: 50,
    label: null,
    createdBy: ACTOR,
  });
  return {
    ...created,
    id: PAYMENT_ID,
    createdAt: new Date("2026-09-05T12:00:00.000Z"),
    ...overrides,
  };
}

function storedPayment2(overrides: Partial<Payment> = {}): Payment {
  return storedPayment({ id: PAYMENT2_ID, ...overrides });
}

/** 確認と、その時点の指紋・取り消し状態を持つ明細を登録する。 */
function seedPreview(
  ctx: InMemorySettlementContext,
  items = [previewItemOf()],
  signedTotal = SignedYen.fromBigInt(3500n),
): PreviewRecord {
  const preview: PreviewRecord = {
    id: PREVIEW_ID,
    tripId: TRIP_ID,
    createdBy: PARTNER,
    createdAt: new Date("2026-09-06T12:00:00.000Z"),
    signedTotal,
  };
  ctx.previewRows.set(PREVIEW_ID, preview);
  ctx.previewItemRows.set(PREVIEW_ID, items);
  return preview;
}

describe("完了の記録の順序（FU-10 の完了側）", () => {
  it("roster → guard.lock → receipts.find → 確認・明細・指紋の読み取り → 連番・保存 → receipts.insert の順", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedTrip();
    ctx.seedPayment(storedPayment());
    seedPreview(ctx, [previewItemOf({ expectedFingerprint: EMPTY_FINGERPRINT })]);

    const result = await createUsecase(uow, writeLog).execute(completeInput());

    expect(result.httpStatus).toBe(201);
    expect(ctx.calls).toEqual([
      "roster.find",
      "financeGuard.lock",
      "receipts.find",
      "settlements.findPreviewInTrip",
      "settlements.findSettlementForPreview",
      "settlements.listPreviewItems",
      "paymentsRead.listInTrip",
      "paymentsRead.listCancellationsInTrip",
      "settlements.claimHistories",
      "financeGuard.issueNextSettlementSequence",
      "settlements.insertSettlement",
      "settlements.insertSettlementItems",
      "settlements.insertActiveClaims",
      "receipts.insert",
    ]);
    expect(writeLog.entries).toEqual([
      expect.objectContaining({ result: "created" }),
    ]);
  });

  it("receipt に残っている再送は何も読まずに保存した結果を返す", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedTrip();
    const stored = { id: SETTLEMENT_ID };
    ctx.seedReceipt({
      actorId: ACTOR,
      operation: COMPLETE_SETTLEMENT_OPERATION,
      idempotencyKey: KEY,
      tripId: TRIP_ID,
      requestHash: "hash-c",
      resourceType: "settlement",
      resourceId: SETTLEMENT_ID,
      httpStatus: 201,
      responseBody: stored,
    });

    const result = await createUsecase(uow, writeLog).execute(completeInput());

    expect(result).toEqual({ httpStatus: 201, body: stored });
    expect(ctx.calls).toEqual([
      "roster.find",
      "financeGuard.lock",
      "receipts.find",
    ]);
    expect(writeLog.entries).toEqual([
      expect.objectContaining({ result: "replayed" }),
    ]);
  });

  it("参加していない旅行は guard の行ロックの前に 403 で止まる", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedTrip("11111111-1111-4111-8111-111111111111");

    await expect(
      createUsecase(uow, writeLog).execute(completeInput()),
    ).rejects.toMatchObject({ code: "TRIP_NOT_ACCESSIBLE", status: 403 });
    expect(ctx.calls).toEqual(["roster.find"]);
  });
});

describe("完了の記録の業務規則", () => {
  it("非 0 円の確認は transfer_completed で 201・連番・明細・占有が残る", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedTrip();
    ctx.seedPayment(storedPayment());
    seedPreview(ctx, [previewItemOf({ expectedFingerprint: EMPTY_FINGERPRINT })]);

    const result = await createUsecase(uow, writeLog).execute(completeInput());

    expect(result.httpStatus).toBe(201);
    const settlement = [...ctx.settlementRecordRows.values()][0]!;
    expect(result.body).toMatchObject({
      id: settlement.id,
      tripId: TRIP_ID,
      previewId: PREVIEW_ID,
      sequence: "1",
      createdBy: ACTOR,
      completionKind: "transfer_completed",
      cancellation: null,
      canCancel: true,
      cannotCancelReason: null,
    });
    expect(result.body.items).toEqual([
      expect.objectContaining({
        kind: "BASE",
        signedContributionYen: "3500",
      }),
    ]);
    // 明細と占有は同じ(payment_id, kind)
    expect(ctx.settlementItemRows.get(settlement.id)).toEqual([
      {
        paymentId: PAYMENT_ID,
        kind: "BASE",
        contribution: 3500n,
        baseSettlementId: null,
      },
    ]);
    expect([...ctx.activeClaimRows.values()]).toEqual([
      { paymentId: PAYMENT_ID, kind: "BASE", settlementId: settlement.id },
    ]);
    // 受領は精算のidを対象行に持つ
    expect([...ctx.receiptRows.values()][0]).toMatchObject({
      resourceType: "settlement",
      resourceId: settlement.id,
      httpStatus: 201,
    });
  });

  it("0 円の確認は no_transfer_required だけが受け付く", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedTrip();
    ctx.seedPayment(storedPayment());
    // 0円の確認（支払いの寄与が0になる形で0にした確認）
    seedPreview(
      ctx,
      [
        previewItemOf({
          contribution: SignedYen.ZERO,
          expectedFingerprint: EMPTY_FINGERPRINT,
        }),
      ],
      SignedYen.ZERO,
    );

    await expect(
      createUsecase(uow, writeLog).execute(
        completeInput({ completionKind: "transfer_completed" }),
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED", status: 422 });
    expect(ctx.settlementRecordRows.size).toBe(0);

    const result = await createUsecase(uow, writeLog).execute(
      completeInput({ completionKind: "no_transfer_required" }),
    );
    expect(result.httpStatus).toBe(201);
    expect(result.body).toMatchObject({
      completionKind: "no_transfer_required",
      transfer: { requiresTransfer: false },
    });
  });

  it("非 0 円の確認に no_transfer_required は 422 で何も残さない", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedTrip();
    ctx.seedPayment(storedPayment());
    seedPreview(ctx, [previewItemOf({ expectedFingerprint: EMPTY_FINGERPRINT })]);

    await expect(
      createUsecase(uow, writeLog).execute(
        completeInput({ completionKind: "no_transfer_required" }),
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED", status: 422 });
    expect(ctx.settlementRecordRows.size).toBe(0);
    expect(ctx.activeClaimRows.size).toBe(0);
    expect(ctx.receiptRows.size).toBe(0);
  });

  it("旅行に無い確認は 404（存在を漏らさない）", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedTrip();
    seedPreview(ctx, [previewItemOf({ expectedFingerprint: EMPTY_FINGERPRINT })]);

    await expect(
      createUsecase(uow, writeLog).execute(
        completeInput({ previewId: "99999999-9999-4999-8999-999999999998" }),
      ),
    ).rejects.toMatchObject({ code: "PREVIEW_NOT_FOUND", status: 404 });
  });

  it("了承の集合に重複があると 400（形式違反）", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedTrip();
    ctx.seedPayment(storedPayment());
    seedPreview(ctx, [previewItemOf({ expectedFingerprint: EMPTY_FINGERPRINT })]);

    await expect(
      createUsecase(uow, writeLog).execute(
        completeInput({
          acknowledgedCancellationPaymentIds: [PAYMENT_ID, PAYMENT_ID],
        }),
      ),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST", status: 400 });
  });

  it("すでに有効な精算がある確認は 200 で既存の精算を返す（E-07）", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedTrip();
    ctx.seedPayment(storedPayment());
    seedPreview(ctx, [previewItemOf({ expectedFingerprint: EMPTY_FINGERPRINT })]);
    ctx.seedSettlementForPreview(
      PREVIEW_ID,
      { id: SETTLEMENT_ID, cancelled: false },
      { sequence: 1 },
    );
    ctx.seedSettlementItems(SETTLEMENT_ID, [
      {
        paymentId: PAYMENT_ID,
        kind: "BASE",
        contribution: SignedYen.fromBigInt(3500n),
        baseSettlementId: null,
      },
    ]);

    const result = await createUsecase(uow, writeLog).execute(
      completeInput({ key: "99999999-9999-4999-8999-999999999997" }),
    );

    expect(result.httpStatus).toBe(200);
    expect(result.body).toMatchObject({
      id: SETTLEMENT_ID,
      previewId: PREVIEW_ID,
      sequence: "1",
      canCancel: true,
    });
    // 新しい精算・占有・受領は増えない
    expect(ctx.settlementRecordRows.size).toBe(1);
    expect(ctx.activeClaimRows.size).toBe(0);
    // receiptは既存の精算を指して残る（同じ再送は同じ結果）
    expect([...ctx.receiptRows.values()][0]).toMatchObject({
      resourceType: "settlement",
      resourceId: SETTLEMENT_ID,
      httpStatus: 200,
    });
  });

  it("取り消し済みの精算がある確認は 409（E-10。新しい確認へ）", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedTrip();
    ctx.seedPayment(storedPayment());
    seedPreview(ctx, [previewItemOf({ expectedFingerprint: EMPTY_FINGERPRINT })]);
    ctx.seedSettlementForPreview(PREVIEW_ID, {
      id: SETTLEMENT_ID,
      cancelled: true,
    });

    await expect(
      createUsecase(uow, writeLog).execute(completeInput()),
    ).rejects.toMatchObject({ code: "PREVIEW_CHANGED", status: 409 });
    expect(ctx.settlementRecordRows.size).toBe(1);
    expect(ctx.activeClaimRows.size).toBe(0);
    expect(ctx.receiptRows.size).toBe(0);
  });

  it("対象の指紋が変わった（占有は無い）は 409 PREVIEW_CHANGED", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedTrip();
    ctx.seedPayment(storedPayment());
    seedPreview(ctx, [previewItemOf({ expectedFingerprint: EMPTY_FINGERPRINT })]);
    // 別の精算が成立してから取り消された → 指紋が変わるが占有は残らない
    ctx.seedClaimHistory(PAYMENT_ID, {
      activeClaims: {},
      items: [{ settlementId: OTHER_SETTLEMENT_ID, kind: "BASE" }],
      cancelledSettlementIds: [OTHER_SETTLEMENT_ID],
    });

    await expect(
      createUsecase(uow, writeLog).execute(completeInput()),
    ).rejects.toMatchObject({ code: "PREVIEW_CHANGED", status: 409 });
    expect(ctx.settlementRecordRows.size).toBe(0);
    expect(ctx.receiptRows.size).toBe(0);
  });

  it("一部の対象だけが別の精算に占有されていると 409 TARGET_PARTIALLY_SETTLED", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedTrip();
    ctx.seedPayment(storedPayment());
    ctx.seedPayment(storedPayment2());
    seedPreview(ctx, [
      previewItemOf({ expectedFingerprint: EMPTY_FINGERPRINT }),
      previewItemOf({
        paymentId: PAYMENT2_ID,
        expectedFingerprint: EMPTY_FINGERPRINT,
      }),
    ]);
    // PAYMENT_IDだけが別の精算で占有されている
    ctx.seedClaim(PAYMENT_ID, "BASE", OTHER_SETTLEMENT_ID);
    ctx.seedClaimHistory(PAYMENT_ID, {
      activeClaims: { BASE: OTHER_SETTLEMENT_ID },
      items: [{ settlementId: OTHER_SETTLEMENT_ID, kind: "BASE" }],
      cancelledSettlementIds: [],
    });

    await expect(
      createUsecase(uow, writeLog).execute(completeInput()),
    ).rejects.toMatchObject({
      code: "TARGET_PARTIALLY_SETTLED",
      status: 409,
    });
    expect(ctx.settlementRecordRows.size).toBe(0);
  });

  it("同じ対象全体が別の 1 つの精算で占有されていると 409 TARGET_ALREADY_SETTLED", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedTrip();
    ctx.seedPayment(storedPayment());
    seedPreview(ctx, [previewItemOf({ expectedFingerprint: EMPTY_FINGERPRINT })]);
    ctx.seedClaim(PAYMENT_ID, "BASE", OTHER_SETTLEMENT_ID);
    ctx.seedClaimHistory(PAYMENT_ID, {
      activeClaims: { BASE: OTHER_SETTLEMENT_ID },
      items: [{ settlementId: OTHER_SETTLEMENT_ID, kind: "BASE" }],
      cancelledSettlementIds: [],
    });
    // 占有している精算の明細がこの確認と同じ対象
    ctx.seedSettlementItems(OTHER_SETTLEMENT_ID, [
      {
        paymentId: PAYMENT_ID,
        kind: "BASE",
        contribution: SignedYen.fromBigInt(3500n),
        baseSettlementId: null,
      },
    ]);

    await expect(
      createUsecase(uow, writeLog).execute(completeInput()),
    ).rejects.toMatchObject({
      code: "TARGET_ALREADY_SETTLED",
      status: 409,
      details: { existingSettlementId: OTHER_SETTLEMENT_ID },
    });
  });

  it("全部が占有されているが別の精算の対象と違う場合は PREVIEW_CHANGED", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedTrip();
    ctx.seedPayment(storedPayment());
    ctx.seedPayment(storedPayment2());
    // 確認は{P1}だけだが、占有している精算は{P1, P2}
    seedPreview(ctx, [previewItemOf({ expectedFingerprint: EMPTY_FINGERPRINT })]);
    ctx.seedClaim(PAYMENT_ID, "BASE", OTHER_SETTLEMENT_ID);
    ctx.seedClaimHistory(PAYMENT_ID, {
      activeClaims: { BASE: OTHER_SETTLEMENT_ID },
      items: [{ settlementId: OTHER_SETTLEMENT_ID, kind: "BASE" }],
      cancelledSettlementIds: [],
    });
    ctx.seedSettlementItems(OTHER_SETTLEMENT_ID, [
      {
        paymentId: PAYMENT_ID,
        kind: "BASE",
        contribution: SignedYen.fromBigInt(3500n),
        baseSettlementId: null,
      },
      {
        paymentId: PAYMENT2_ID,
        kind: "BASE",
        contribution: SignedYen.fromBigInt(3500n),
        baseSettlementId: null,
      },
    ]);

    await expect(
      createUsecase(uow, writeLog).execute(completeInput()),
    ).rejects.toMatchObject({ code: "PREVIEW_CHANGED", status: 409 });
  });

  it("BASE 対象があとで取り消された: 了承なし・集合が違うは 409、一致すれば 201（F-32）", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedTrip();
    ctx.seedPayment(storedPayment());
    seedPreview(ctx, [previewItemOf({ expectedFingerprint: EMPTY_FINGERPRINT })]);
    ctx.cancellationRows.set(PAYMENT_ID, {
      paymentId: PAYMENT_ID,
      tripId: TRIP_ID,
      cancelledBy: PARTNER,
      createdAt: new Date("2026-09-06T12:00:00.000Z"),
    });

    // 了承なし → 409
    await expect(
      createUsecase(uow, writeLog).execute(completeInput()),
    ).rejects.toMatchObject({
      code: "CANCELLED_ITEMS_ACK_REQUIRED",
      status: 409,
    });
    // 集合が違う → 409
    await expect(
      createUsecase(uow, writeLog).execute(
        completeInput({
          acknowledgedCancellationPaymentIds: [PAYMENT2_ID],
        }),
      ),
    ).rejects.toMatchObject({
      code: "CANCELLED_ITEMS_ACK_REQUIRED",
      status: 409,
    });
    expect(ctx.settlementRecordRows.size).toBe(0);

    // 完全一致 → 201（完了の記録に取り消し済み支払いの明細が入る）
    const result = await createUsecase(uow, writeLog).execute(
      completeInput({ acknowledgedCancellationPaymentIds: [PAYMENT_ID] }),
    );
    expect(result.httpStatus).toBe(201);
    expect(result.body.items).toEqual([
      expect.objectContaining({
        kind: "BASE",
        signedContributionYen: "3500",
      }),
    ]);
  });

  it("取り消しが無いのに了承が送られても集合が違う 409", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedTrip();
    ctx.seedPayment(storedPayment());
    seedPreview(ctx, [previewItemOf({ expectedFingerprint: EMPTY_FINGERPRINT })]);

    await expect(
      createUsecase(uow, writeLog).execute(
        completeInput({ acknowledgedCancellationPaymentIds: [PAYMENT_ID] }),
      ),
    ).rejects.toMatchObject({
      code: "CANCELLED_ITEMS_ACK_REQUIRED",
      status: 409,
    });
  });
});
