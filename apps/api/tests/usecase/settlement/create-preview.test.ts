import { describe, expect, it } from "vitest";
import type { UnitOfWork } from "../../../src/adapter/transaction/unit-of-work";
import { PaymentYen, SignedYen } from "../../../src/common/domain/yen";
import type { IdempotencyKey } from "../../../src/common/http/idempotency-key";
import type { CommandReceipt } from "../../../src/common/idempotency/command-receipt";
import { CREATE_PREVIEW_OPERATION } from "../../../src/modules/settlement/adapter/inbound/create-preview.input-port";
import type { SettlementWorkContext } from "../../../src/modules/settlement/adapter/outbound/settlement-work-context";
import { fingerprintOf } from "../../../src/modules/settlement/domain/fingerprint";
import { CreatePreviewUseCase } from "../../../src/modules/settlement/usecase/create-preview.usecase";
import type { Payment } from "../../../src/modules/record/domain/payment";
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
} from "../../support/settlement-context";

const PAYMENT_ID = "77777777-7777-4777-8777-000000000001";
const SETTLEMENT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-000000000001";

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
  return new CreatePreviewUseCase(uow, writeLog);
}

function createInput(overrides: Partial<{
  key: IdempotencyKey;
  requestHash: string;
  userId: string;
  tripId: string;
}> = {}) {
  return {
    userId: ACTOR,
    tripId: TRIP_ID,
    key: KEY,
    requestHash: "hash-p",
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

function receiptOf(overrides: Partial<CommandReceipt> = {}): CommandReceipt {
  return {
    actorId: ACTOR,
    operation: CREATE_PREVIEW_OPERATION,
    idempotencyKey: KEY,
    tripId: TRIP_ID,
    requestHash: "hash-p",
    resourceType: "preview",
    resourceId: "aaaaaaaa-aaaa-4aaa-8aaa-000000000001",
    httpStatus: 201,
    responseBody: { stored: true },
    ...overrides,
  };
}

describe("確認の作成の順序（FU-10 の確認側）", () => {
  it("roster → guard.lock → receipts.find → 対象の読み取り → 保存 → receipts.insert の順", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedTrip();
    ctx.seedPayment(storedPayment());

    const result = await createUsecase(uow, writeLog).execute(createInput());

    expect(result.httpStatus).toBe(201);
    expect(ctx.calls).toEqual([
      "roster.find",
      "financeGuard.lock",
      "receipts.find",
      "paymentsRead.listInTrip",
      "paymentsRead.listCancellationsInTrip",
      "settlements.listActiveClaims",
      "settlements.claimHistories",
      "settlements.insertPreview",
      "settlements.insertPreviewItems",
      "receipts.insert",
    ]);
  });

  it("receipt に残っている再送は対象を読まずに保存した結果を返す", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedTrip();
    const stored = { id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000001" };
    ctx.seedReceipt(receiptOf({ responseBody: stored }));

    const result = await createUsecase(uow, writeLog).execute(createInput());

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
      createUsecase(uow, writeLog).execute(createInput()),
    ).rejects.toMatchObject({ code: "TRIP_NOT_ACCESSIBLE", status: 403 });
    expect(ctx.calls).toEqual(["roster.find"]);
  });
});

describe("確認の作成の業務規則", () => {
  it("対象 0 件は 422 NO_SETTLEMENT_TARGET で、保存も receipt も残さない", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedTrip();

    await expect(
      createUsecase(uow, writeLog).execute(createInput()),
    ).rejects.toMatchObject({ code: "NO_SETTLEMENT_TARGET", status: 422 });
    expect(ctx.previewRows.size).toBe(0);
    expect(ctx.previewItemRows.size).toBe(0);
    expect(ctx.receiptRows.size).toBe(0);
  });

  it("明細にはその時点の指紋と取り消し状態が入り、合計は明細の合計", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedTrip();
    ctx.seedPayment(storedPayment());
    const history = {
      activeClaims: {},
      items: [
        { settlementId: "cccccccc-cccc-4ccc-8ccc-000000000001", kind: "BASE" as const },
      ],
      cancelledSettlementIds: [],
    };
    ctx.seedClaimHistory(PAYMENT_ID, history);

    const result = await createUsecase(uow, writeLog).execute(createInput());

    expect(result.httpStatus).toBe(201);
    const preview = [...ctx.previewRows.values()][0]!;
    expect(result.body).toMatchObject({
      id: preview.id,
      tripId: TRIP_ID,
      createdBy: ACTOR,
      transfer: {
        signedTotalYen: "3500",
        amountYen: "3500",
        fromUserId: PARTNER,
        toUserId: ACTOR,
        requiresTransfer: true,
      },
      validation: {
        status: "ready",
        cancelledPaymentIds: [],
        changedPaymentIds: [],
        existingSettlementId: null,
      },
    });
    expect(result.body.participants).toEqual([
      { userId: ACTOR, slot: 0, displayName: "ひなた" },
      { userId: PARTNER, slot: 1, displayName: "あおい" },
    ]);
    const items = ctx.previewItemRows.get(preview.id)!;
    expect(items).toEqual([
      {
        paymentId: PAYMENT_ID,
        kind: "BASE",
        contribution: 3500n,
        baseSettlementId: null,
        expectedFingerprint: fingerprintOf(history),
        expectedCancelled: false,
      },
    ]);
    expect(preview.signedTotal).toBe(3500n);
  });

  it("取り消し済みで精算済みの支払いは戻しの明細（−c・expectedCancelled=true）になる", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedTrip();
    ctx.seedPayment(storedPayment());
    ctx.seedClaim(PAYMENT_ID, "BASE", SETTLEMENT_ID);
    ctx.cancellationRows.set(PAYMENT_ID, {
      paymentId: PAYMENT_ID,
      tripId: TRIP_ID,
      cancelledBy: PARTNER,
      createdAt: new Date("2026-09-06T12:00:00.000Z"),
    });
    const history = {
      activeClaims: { BASE: SETTLEMENT_ID },
      items: [{ settlementId: SETTLEMENT_ID, kind: "BASE" as const }],
      cancelledSettlementIds: [],
    };
    ctx.seedClaimHistory(PAYMENT_ID, history);

    const result = await createUsecase(uow, writeLog).execute(createInput());

    expect(result.httpStatus).toBe(201);
    const preview = [...ctx.previewRows.values()][0]!;
    const items = ctx.previewItemRows.get(preview.id)!;
    expect(items).toEqual([
      {
        paymentId: PAYMENT_ID,
        kind: "REVERSAL",
        contribution: SignedYen.fromBigInt(-3500n),
        baseSettlementId: SETTLEMENT_ID,
        expectedFingerprint: fingerprintOf(history),
        expectedCancelled: true,
      },
    ]);
    expect(preview.signedTotal).toBe(SignedYen.fromBigInt(-3500n));
    expect(result.body.transfer).toMatchObject({
      signedTotalYen: "-3500",
      amountYen: "3500",
      fromUserId: ACTOR,
      toUserId: PARTNER,
    });
    expect(result.body.items[0]).toMatchObject({
      kind: "REVERSAL",
      baseSettlementId: SETTLEMENT_ID,
      signedContributionYen: "-3500",
    });
  });
});
