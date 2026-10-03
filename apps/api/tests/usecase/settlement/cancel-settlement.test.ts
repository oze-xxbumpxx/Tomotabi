import { describe, expect, it } from "vitest";
import type { UnitOfWork } from "../../../src/adapter/transaction/unit-of-work";
import type { IdempotencyKey } from "../../../src/common/http/idempotency-key";
import { CANCEL_SETTLEMENT_OPERATION } from "../../../src/modules/settlement/adapter/inbound/cancel-settlement.input-port";
import type { SettlementWorkContext } from "../../../src/modules/settlement/adapter/outbound/settlement-work-context";
import { CancelSettlementUseCase } from "../../../src/modules/settlement/usecase/cancel-settlement.usecase";
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

const SETTLEMENT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-000000000001";
const NEWER_SETTLEMENT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-000000000002";
const PAYMENT_ID = "77777777-7777-4777-8777-000000000001";

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
  return new CancelSettlementUseCase(uow, writeLog);
}

function cancelInput(
  overrides: Partial<{
    key: IdempotencyKey;
    requestHash: string;
    userId: string;
    tripId: string;
    settlementId: string;
  }> = {},
) {
  return {
    userId: ACTOR,
    tripId: TRIP_ID,
    settlementId: SETTLEMENT_ID,
    key: KEY,
    requestHash: "hash-x",
    ...overrides,
  };
}

describe("精算の取り消し", () => {
  it("取り消しの追記と占有の削除が同じ作業で行われ、receipt も残る", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedTrip();
    ctx.seedSettlement({ id: SETTLEMENT_ID, sequence: 1 });
    ctx.seedClaim(PAYMENT_ID, "BASE", SETTLEMENT_ID);

    const result = await createUsecase(uow, writeLog).execute(cancelInput());

    expect(result.httpStatus).toBe(201);
    expect(result.body).toMatchObject({
      targetId: SETTLEMENT_ID,
      cancelledBy: ACTOR,
    });
    expect(ctx.calls).toEqual([
      "roster.find",
      "financeGuard.lock",
      "receipts.find",
      "settlements.findSettlementInTrip",
      "settlements.findSettlementCancellation",
      "settlements.findLatestActiveSettlement",
      "settlements.insertSettlementCancellation",
      "settlements.deleteActiveClaimsForSettlement",
      "receipts.insert",
    ]);
    // 占有は消え、取り消しの記録が残る
    expect(ctx.activeClaimRows.size).toBe(0);
    expect(ctx.settlementCancellationRows.get(SETTLEMENT_ID)).toMatchObject({
      settlementId: SETTLEMENT_ID,
      tripId: TRIP_ID,
    });
    expect([...ctx.receiptRows.values()][0]).toMatchObject({
      resourceType: "settlement_cancellation",
      resourceId: SETTLEMENT_ID,
      httpStatus: 201,
    });
    expect(writeLog.entries).toEqual([
      expect.objectContaining({ result: "created" }),
    ]);
  });

  it("すでに取り消されている精算は 200 で既存の取り消しを返し、占有は再び消さない", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedTrip();
    ctx.seedSettlement({ id: SETTLEMENT_ID, sequence: 1 });
    ctx.seedSettlementCancellation(SETTLEMENT_ID, { cancelledBy: PARTNER });

    const result = await createUsecase(uow, writeLog).execute(
      cancelInput({ key: "99999999-9999-4999-8999-999999999997" }),
    );

    expect(result.httpStatus).toBe(200);
    expect(result.body).toMatchObject({
      targetId: SETTLEMENT_ID,
      cancelledBy: PARTNER,
    });
    expect(ctx.calls).not.toContain("settlements.insertSettlementCancellation");
    expect(ctx.calls).not.toContain("settlements.deleteActiveClaimsForSettlement");
  });

  it("最新でない有効な精算は 409 SETTLEMENT_NOT_LATEST（F-36）", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedTrip();
    ctx.seedSettlement({ id: SETTLEMENT_ID, sequence: 1 });
    ctx.seedSettlement({ id: NEWER_SETTLEMENT_ID, sequence: 2 });
    ctx.seedClaim(PAYMENT_ID, "BASE", SETTLEMENT_ID);

    await expect(
      createUsecase(uow, writeLog).execute(cancelInput()),
    ).rejects.toMatchObject({ code: "SETTLEMENT_NOT_LATEST", status: 409 });
    // 取り消しも占有の削除も残らない
    expect(ctx.settlementCancellationRows.size).toBe(0);
    expect(ctx.activeClaimRows.size).toBe(1);
    expect(ctx.receiptRows.size).toBe(0);
  });

  it("新しい精算が先に取り消されていれば、残った最新の有効な精算は取り消せる", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedTrip();
    ctx.seedSettlement({ id: SETTLEMENT_ID, sequence: 1 });
    ctx.seedSettlement({ id: NEWER_SETTLEMENT_ID, sequence: 2 });
    ctx.seedSettlementCancellation(NEWER_SETTLEMENT_ID);

    const result = await createUsecase(uow, writeLog).execute(cancelInput());

    expect(result.httpStatus).toBe(201);
    expect(ctx.settlementCancellationRows.has(SETTLEMENT_ID)).toBe(true);
  });

  it("旅行の中に無い精算は 404（存在を漏らさない）", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedTrip();
    // 別の旅行の精算
    ctx.seedSettlement({
      id: SETTLEMENT_ID,
      tripId: "11111111-1111-4111-8111-111111111111",
      sequence: 1,
    });

    await expect(
      createUsecase(uow, writeLog).execute(cancelInput()),
    ).rejects.toMatchObject({ code: "SETTLEMENT_NOT_FOUND", status: 404 });
  });

  it("receipt に残っている再送は対象を読まずに保存した結果を返す", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedTrip();
    const stored = { targetId: SETTLEMENT_ID };
    ctx.seedReceipt({
      actorId: ACTOR,
      operation: CANCEL_SETTLEMENT_OPERATION,
      idempotencyKey: KEY,
      tripId: TRIP_ID,
      requestHash: "hash-x",
      resourceType: "settlement_cancellation",
      resourceId: SETTLEMENT_ID,
      httpStatus: 201,
      responseBody: stored,
    });

    const result = await createUsecase(uow, writeLog).execute(cancelInput());

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
      createUsecase(uow, writeLog).execute(cancelInput()),
    ).rejects.toMatchObject({ code: "TRIP_NOT_ACCESSIBLE", status: 403 });
    expect(ctx.calls).toEqual(["roster.find"]);
  });
});
