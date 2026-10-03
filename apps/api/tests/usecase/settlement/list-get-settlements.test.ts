import { describe, expect, it } from "vitest";
import { PaymentYen, SignedYen } from "../../../src/common/domain/yen";
import type { SettlementItemRecord } from "../../../src/modules/settlement/adapter/outbound/settlement.repository";
import { encodeSettlementCursor } from "../../../src/modules/settlement/usecase/settlement-cursor";
import { GetSettlementUseCase } from "../../../src/modules/settlement/usecase/get-settlement.usecase";
import { ListSettlementsUseCase } from "../../../src/modules/settlement/usecase/list-settlements.usecase";
import { Payment } from "../../../src/modules/record/domain/payment";
import { ACTOR, PARTNER } from "../../support/planning-context";
import { TRIP_ID } from "../../support/finance-context";
import {
  InMemorySettlementContext,
  inMemorySettlementUnitOfWork,
} from "../../support/settlement-context";

const SETTLEMENT1_ID = "bbbbbbbb-bbbb-4bbb-8bbb-000000000001";
const SETTLEMENT2_ID = "bbbbbbbb-bbbb-4bbb-8bbb-000000000002";
const SETTLEMENT3_ID = "bbbbbbbb-bbbb-4bbb-8bbb-000000000003";
const PAYMENT_ID = "77777777-7777-4777-8777-000000000001";

function setup() {
  const ctx = new InMemorySettlementContext();
  const uow = inMemorySettlementUnitOfWork(ctx);
  return { ctx, uow };
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

function itemOf(settlementOverrides: Partial<SettlementItemRecord> = {}): SettlementItemRecord {
  return {
    paymentId: PAYMENT_ID,
    kind: "BASE",
    contribution: SignedYen.fromBigInt(3500n),
    baseSettlementId: null,
    ...settlementOverrides,
  };
}

function seedThree(ctx: InMemorySettlementContext) {
  ctx.seedPayment(storedPayment());
  ctx.seedSettlement({ id: SETTLEMENT1_ID, sequence: 1 });
  ctx.seedSettlementItems(SETTLEMENT1_ID, [itemOf()]);
  ctx.seedSettlement({
    id: SETTLEMENT2_ID,
    sequence: 2,
    signedTotal: SignedYen.fromBigInt(-3500n),
  });
  ctx.seedSettlementItems(SETTLEMENT2_ID, [
    itemOf({ kind: "REVERSAL", contribution: SignedYen.fromBigInt(-3500n), baseSettlementId: SETTLEMENT1_ID }),
  ]);
  ctx.seedSettlement({ id: SETTLEMENT3_ID, sequence: 3 });
  ctx.seedSettlementItems(SETTLEMENT3_ID, [itemOf()]);
}

describe("精算の一覧", () => {
  it("連番の降順で返し、取り消し済みの件には取り消し履歴と already_cancelled が付く", async () => {
    const { ctx, uow } = setup();
    ctx.seedTrip();
    seedThree(ctx);
    ctx.seedSettlementCancellation(SETTLEMENT3_ID, { cancelledBy: PARTNER });

    const result = await new ListSettlementsUseCase(uow).execute({
      userId: ACTOR,
      tripId: TRIP_ID,
      cursor: null,
      limit: 20,
    });

    expect(result.items.map((item) => item.sequence)).toEqual(["3", "2", "1"]);
    expect(result.items[0]).toMatchObject({
      id: SETTLEMENT3_ID,
      cancellation: { targetId: SETTLEMENT3_ID, cancelledBy: PARTNER },
      canCancel: false,
      cannotCancelReason: "already_cancelled",
    });
    // 有効なうち連番が最大の精算だけ取り消せる
    expect(result.items[1]).toMatchObject({
      id: SETTLEMENT2_ID,
      cancellation: null,
      canCancel: true,
      cannotCancelReason: null,
    });
    expect(result.items[2]).toMatchObject({
      id: SETTLEMENT1_ID,
      canCancel: false,
      cannotCancelReason: "not_latest",
    });
    // REVERSAL明細は戻す対象の精算を指す
    expect(result.items[1].items[0]).toMatchObject({
      kind: "REVERSAL",
      baseSettlementId: SETTLEMENT1_ID,
      signedContributionYen: "-3500",
    });
    expect(result.nextCursor).toBeNull();
  });

  it("limit 件ずつカーソルで続きを読む（起点の行は次のページに含まれない）", async () => {
    const { ctx, uow } = setup();
    ctx.seedTrip();
    seedThree(ctx);

    const first = await new ListSettlementsUseCase(uow).execute({
      userId: ACTOR,
      tripId: TRIP_ID,
      cursor: null,
      limit: 2,
    });
    expect(first.items.map((item) => item.sequence)).toEqual(["3", "2"]);
    expect(first.nextCursor).not.toBeNull();

    const second = await new ListSettlementsUseCase(uow).execute({
      userId: ACTOR,
      tripId: TRIP_ID,
      cursor: first.nextCursor,
      limit: 2,
    });
    expect(second.items.map((item) => item.sequence)).toEqual(["1"]);
    expect(second.nextCursor).toBeNull();
  });

  it("形が不正なカーソルは 400 INVALID_REQUEST", async () => {
    const { ctx, uow } = setup();
    ctx.seedTrip();

    await expect(
      new ListSettlementsUseCase(uow).execute({
        userId: ACTOR,
        tripId: TRIP_ID,
        cursor: "not-a-cursor",
        limit: 20,
      }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST", status: 400 });
  });

  it("別の旅行の精算を指すカーソルは 400（続きを偽造できない）", async () => {
    const { ctx, uow } = setup();
    ctx.seedTrip();
    const foreignTrip = "11111111-1111-4111-8111-111111111111";
    ctx.seedSettlement({
      id: SETTLEMENT1_ID,
      tripId: foreignTrip,
      sequence: 1,
    });

    await expect(
      new ListSettlementsUseCase(uow).execute({
        userId: ACTOR,
        tripId: TRIP_ID,
        cursor: encodeSettlementCursor(SETTLEMENT1_ID),
        limit: 20,
      }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST", status: 400 });
  });
});

describe("精算の取得", () => {
  it("元の明細・記録した人・取り消し履歴を返す", async () => {
    const { ctx, uow } = setup();
    ctx.seedTrip();
    seedThree(ctx);
    ctx.seedSettlementCancellation(SETTLEMENT3_ID, { cancelledBy: PARTNER });

    const result = await new GetSettlementUseCase(uow).execute({
      userId: ACTOR,
      tripId: TRIP_ID,
      settlementId: SETTLEMENT3_ID,
    });

    expect(result).toMatchObject({
      id: SETTLEMENT3_ID,
      tripId: TRIP_ID,
      sequence: "3",
      createdBy: ACTOR,
      completionKind: "transfer_completed",
      cancellation: { targetId: SETTLEMENT3_ID, cancelledBy: PARTNER },
      canCancel: false,
      cannotCancelReason: "already_cancelled",
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.kind).toBe("BASE");
  });

  it("無い・別の旅行の精算は同じ 404（存在を漏らさない）", async () => {
    const { ctx, uow } = setup();
    ctx.seedTrip();
    ctx.seedSettlement({
      id: SETTLEMENT1_ID,
      tripId: "11111111-1111-4111-8111-111111111111",
      sequence: 1,
    });

    await expect(
      new GetSettlementUseCase(uow).execute({
        userId: ACTOR,
        tripId: TRIP_ID,
        settlementId: SETTLEMENT1_ID,
      }),
    ).rejects.toMatchObject({ code: "SETTLEMENT_NOT_FOUND", status: 404 });
    await expect(
      new GetSettlementUseCase(uow).execute({
        userId: ACTOR,
        tripId: TRIP_ID,
        settlementId: "99999999-9999-4999-8999-999999999998",
      }),
    ).rejects.toMatchObject({ code: "SETTLEMENT_NOT_FOUND", status: 404 });
  });
});
