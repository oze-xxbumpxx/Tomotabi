import { describe, expect, it } from "vitest";
import type { UnitOfWork } from "../../../src/adapter/transaction/unit-of-work";
import type { IdempotencyKey } from "../../../src/common/http/idempotency-key";
import { BoundedText } from "../../../src/common/domain/bounded-text";
import { PaymentYen } from "../../../src/common/domain/yen";
import type { CommandReceipt } from "../../../src/common/idempotency/command-receipt";
import { CREATE_PAYMENT_OPERATION } from "../../../src/modules/record/adapter/inbound/create-payment.input-port";
import type { FinanceWorkContext } from "../../../src/modules/record/adapter/outbound/finance-work-context";
import { CancelPaymentUseCase } from "../../../src/modules/record/usecase/cancel-payment.usecase";
import { CreatePaymentUseCase } from "../../../src/modules/record/usecase/create-payment.usecase";
import { GetPaymentUseCase } from "../../../src/modules/record/usecase/get-payment.usecase";
import { Payment } from "../../../src/modules/record/domain/payment";
import {
  ACTOR,
  KEY,
  PARTNER,
  RecordingWriteLog,
} from "../../support/planning-context";
import {
  InMemoryFinanceContext,
  inMemoryFinanceUnitOfWork,
  PLAN_ID,
  TRIP_ID,
} from "../../support/finance-context";

const PAYMENT_ID = "77777777-7777-4777-8777-000000000001";

function setup() {
  const ctx = new InMemoryFinanceContext();
  const uow = inMemoryFinanceUnitOfWork(ctx);
  const writeLog = new RecordingWriteLog();
  return { ctx, uow, writeLog };
}

function createUsecase(
  uow: UnitOfWork<FinanceWorkContext>,
  writeLog: RecordingWriteLog,
) {
  return new CreatePaymentUseCase(uow, writeLog);
}

function cancelUsecase(
  uow: UnitOfWork<FinanceWorkContext>,
  writeLog: RecordingWriteLog,
) {
  return new CancelPaymentUseCase(uow, writeLog);
}

function createInput(overrides: Partial<{
  requestHash: string;
  key: IdempotencyKey;
  amountYen: string;
  payerUserId: string;
  allocations: readonly { userId: string; percent: number }[];
  label: string | null;
  planId: string | null;
}> = {}) {
  return {
    userId: ACTOR,
    tripId: TRIP_ID,
    key: KEY,
    requestHash: "hash-c",
    amountYen: "7001",
    payerUserId: ACTOR,
    allocations: [
      { userId: ACTOR, percent: 50 },
      { userId: PARTNER, percent: 50 },
    ],
    label: null,
    planId: null,
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

function receiptOf(
  operation: string,
  overrides: Partial<CommandReceipt> = {},
): CommandReceipt {
  return {
    actorId: ACTOR,
    operation,
    idempotencyKey: KEY,
    tripId: TRIP_ID,
    requestHash: "hash-c",
    resourceType: "payment",
    resourceId: PAYMENT_ID,
    httpStatus: 201,
    responseBody: { stored: true },
    ...overrides,
  };
}

// FU-10: 財務の書き込みの順序（guardの行ロック → receipt → 対象の読み取り → 保存）
describe("財務の書き込みの順序（FU-10）", () => {
  it("支払いの記録は roster → guard.lock → receipts.find → plans.existsInTrip → payments.insert → receipts.insert の順", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedTrip();
    ctx.seedPlan(PLAN_ID, TRIP_ID);

    const result = await createUsecase(uow, writeLog).execute(
      createInput({ planId: PLAN_ID }),
    );

    expect(result.httpStatus).toBe(201);
    expect(ctx.calls).toEqual([
      "roster.find",
      "financeGuard.lock",
      "receipts.find",
      "plans.existsInTrip",
      "payments.insert",
      "receipts.insert",
    ]);
  });

  it("支払いの取り消しは roster → guard.lock → receipts.find → 支払い・取消の読み取り → insertCancellation → receipts.insert の順", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedTrip();
    ctx.seedPayment(storedPayment());

    const result = await cancelUsecase(uow, writeLog).execute({
      userId: ACTOR,
      tripId: TRIP_ID,
      paymentId: PAYMENT_ID,
      key: KEY,
      requestHash: "hash-x",
    });

    expect(result.httpStatus).toBe(201);
    expect(ctx.calls).toEqual([
      "roster.find",
      "financeGuard.lock",
      "receipts.find",
      "payments.findInTrip",
      "payments.findCancellationInTrip",
      "payments.insertCancellation",
      "receipts.insert",
    ]);
  });

  it("receipt に残っている再送は対象を読まずに保存した結果を返す", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedTrip();
    const stored = { id: PAYMENT_ID, note: "receipt の中身" };
    ctx.seedReceipt(
      receiptOf(CREATE_PAYMENT_OPERATION, { responseBody: stored }),
    );

    const result = await createUsecase(uow, writeLog).execute(
      createInput({ requestHash: "hash-c" }),
    );

    expect(result).toEqual({ httpStatus: 201, body: stored });
    // guardの行ロック → receiptの照会で終わり、対象の読み取り・保存はしない
    expect(ctx.calls).toEqual([
      "roster.find",
      "financeGuard.lock",
      "receipts.find",
    ]);
    expect(writeLog.entries).toEqual([
      expect.objectContaining({ result: "replayed", resourceId: PAYMENT_ID }),
    ]);
  });

  it("参加していない旅行は guard の行ロックの前に 403 で止まる", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedTrip("11111111-1111-4111-8111-111111111111" as string);

    await expect(
      createUsecase(uow, writeLog).execute(createInput()),
    ).rejects.toMatchObject({ code: "TRIP_NOT_ACCESSIBLE", status: 403 });
    expect(ctx.calls).toEqual(["roster.find"]);
  });
});

describe("受領の一意違反（別の旅行への同時送信。must 対応）", () => {
  it("23505 で負けたら勝った側の受領を読み直して、本文が違えば 409", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedTrip();
    // 別の旅行への同時送信が先にCOMMITした受領（hashが違う）
    ctx.winningReceiptOnFailure = receiptOf(CREATE_PAYMENT_OPERATION, {
      tripId: "11111111-1111-4111-8111-111111111111",
      requestHash: "hash-of-other-trip",
    });
    ctx.failReceiptInsertTimes = 1;

    await expect(
      createUsecase(uow, writeLog).execute(createInput()),
    ).rejects.toMatchObject({
      code: "IDEMPOTENCY_KEY_REUSED",
      status: 409,
    });
    // 1回目: 保存まで進んでinsertで負ける。2回目: 受領の照会で409。
    expect(ctx.calls).toEqual([
      "roster.find",
      "financeGuard.lock",
      "receipts.find",
      "payments.insert",
      "receipts.insert",
      "receipts.find",
    ]);
    // 勝った側の受領だけが見える（負けた側の巻き戻しは実DBの試験で確かめる）
    expect(ctx.receiptRows.size).toBe(1);
  });

  it("23505 で負けても hash が同じなら、勝った側が保存した結果を返す", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedTrip();
    const stored = { id: PAYMENT_ID, note: "receipt の中身" };
    ctx.winningReceiptOnFailure = receiptOf(CREATE_PAYMENT_OPERATION, {
      requestHash: "hash-c",
      responseBody: stored,
    });
    ctx.failReceiptInsertTimes = 1;

    const result = await createUsecase(uow, writeLog).execute(createInput());
    expect(result).toEqual({ httpStatus: 201, body: stored });
    expect(writeLog.entries.at(-1)).toMatchObject({
      result: "replayed",
      resourceId: PAYMENT_ID,
    });
  });
});

describe("支払いの記録の業務規則", () => {
  it("分け方の合計が 100 でない・参加者以外・重複は 422 で保存も receipt も残さない", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedTrip();
    const usecase = createUsecase(uow, writeLog);

    const cases: readonly { userId: string; percent: number }[][] = [
      [
        { userId: ACTOR, percent: 60 },
        { userId: PARTNER, percent: 50 },
      ],
      [
        { userId: ACTOR, percent: 101 },
        { userId: PARTNER, percent: -1 },
      ],
      [
        { userId: ACTOR, percent: 50 },
        { userId: "66666666-6666-4666-8666-666666666666", percent: 50 },
      ],
      [
        { userId: ACTOR, percent: 50 },
        { userId: ACTOR, percent: 50 },
      ],
      [{ userId: ACTOR, percent: 100 }],
    ];
    for (const allocations of cases) {
      await expect(
        usecase.execute(createInput({ allocations })),
      ).rejects.toMatchObject({ code: "VALIDATION_FAILED", status: 422 });
    }
    expect(ctx.paymentRows.size).toBe(0);
    expect(ctx.receiptRows.size).toBe(0);
  });

  it("金額が 1〜9,999,999 円の外なら 422（生成スキーマのパターンより内側の規則）", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedTrip();
    const usecase = createUsecase(uow, writeLog);

    await expect(
      usecase.execute(createInput({ amountYen: "10000000" })),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED", status: 422 });
    await expect(
      usecase.execute(createInput({ amountYen: "0" })),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED", status: 422 });
    expect(ctx.paymentRows.size).toBe(0);
    // 値の規則はトランザクションの前に検査する（文脈を呼ばない）
    expect(ctx.calls).toEqual([]);
  });

  it("払った人が参加者でない・別の旅行の予定は 422", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedTrip();
    ctx.seedPlan(PLAN_ID, "11111111-1111-4111-8111-111111111111");
    const usecase = createUsecase(uow, writeLog);

    await expect(
      usecase.execute(createInput({ payerUserId: PLAN_ID })),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED", status: 422 });
    await expect(
      usecase.execute(createInput({ planId: PLAN_ID })),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED", status: 422 });
    expect(ctx.paymentRows.size).toBe(0);
  });
});

describe("支払いの取り消しの業務規則", () => {
  it("取り消し済みの支払いは既存の取り消しを 200 で返す", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedTrip();
    ctx.seedPayment(storedPayment());

    await cancelUsecase(uow, writeLog).execute({
      userId: ACTOR,
      tripId: TRIP_ID,
      paymentId: PAYMENT_ID,
      key: KEY,
      requestHash: "hash-1",
    });
    ctx.calls.length = 0;
    const again = await cancelUsecase(uow, writeLog).execute({
      userId: PARTNER,
      tripId: TRIP_ID,
      paymentId: PAYMENT_ID,
      key: "22222222-2222-4222-8222-222222222222" as IdempotencyKey,
      requestHash: "hash-2",
    });

    expect(again.httpStatus).toBe(200);
    expect(again.body.targetId).toBe(PAYMENT_ID);
    expect(ctx.calls).toEqual([
      "roster.find",
      "financeGuard.lock",
      "receipts.find",
      "payments.findInTrip",
      "payments.findCancellationInTrip",
      "receipts.insert",
    ]);
    expect(ctx.cancellationRows.size).toBe(1);
  });

  it("別の旅行の支払い・無い支払いは同じ 404", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedTrip();
    ctx.seedPayment(storedPayment({ tripId: "other-trip" }));

    await expect(
      cancelUsecase(uow, writeLog).execute({
        userId: ACTOR,
        tripId: TRIP_ID,
        paymentId: PAYMENT_ID,
        key: KEY,
        requestHash: "hash-x",
      }),
    ).rejects.toMatchObject({ code: "PAYMENT_NOT_FOUND", status: 404 });
    await expect(
      cancelUsecase(uow, writeLog).execute({
        userId: ACTOR,
        tripId: TRIP_ID,
        paymentId: "55555555-5555-4555-8555-555555555555",
        key: KEY,
        requestHash: "hash-y",
      }),
    ).rejects.toMatchObject({ code: "PAYMENT_NOT_FOUND", status: 404 });
  });
});

describe("支払いの取得", () => {
  it("支払いと取り消しを返す（読み取りは guard の行ロックを取らない）", async () => {
    const { ctx, uow } = setup();
    ctx.seedTrip();
    ctx.seedPayment(storedPayment({ label: BoundedText.parse("宿泊費", 100) }));

    const payment = await new GetPaymentUseCase(uow).execute({
      userId: ACTOR,
      tripId: TRIP_ID,
      paymentId: PAYMENT_ID,
    });
    expect(payment).toMatchObject({
      id: PAYMENT_ID,
      tripId: TRIP_ID,
      label: "宿泊費",
      amountYen: "7001",
      payerUserId: ACTOR,
      cancellation: null,
    });
    expect(ctx.calls).toEqual([
      "roster.find",
      "payments.findInTrip",
      "payments.findCancellationInTrip",
    ]);

    await expect(
      new GetPaymentUseCase(uow).execute({
        userId: ACTOR,
        tripId: TRIP_ID,
        paymentId: "55555555-5555-4555-8555-555555555555",
      }),
    ).rejects.toMatchObject({ code: "PAYMENT_NOT_FOUND", status: 404 });
  });
});

describe("書き込みログに入力の中身を出さない（FH-17 の UseCase 側）", () => {
  it("作成・拒否どちらのエントリも定めた鍵だけを持つ", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedTrip();
    await createUsecase(uow, writeLog).execute(
      createInput({ label: "機密の用途", amountYen: "12345" }),
    );
    await expect(
      createUsecase(uow, writeLog).execute(
        createInput({
          allocations: [],
          key: "33333333-3333-4333-8333-333333333333" as IdempotencyKey,
          requestHash: "hash-d",
        }),
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });

    for (const entry of writeLog.entries) {
      expect(Object.keys(entry).sort()).toEqual(
        ["durationMs", "errorCode", "operation", "resourceId", "result", "tripId"].sort(),
      );
    }
    const serialized = JSON.stringify(writeLog.entries);
    expect(serialized).not.toContain("機密の用途");
    expect(serialized).not.toContain("12345");
    expect(serialized).not.toContain(KEY);
  });
});
