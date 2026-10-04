import { describe, expect, it } from "vitest";
import type { TimelineItemKind } from "@tomotabi/contracts";
import { PaymentYen } from "../../../src/common/domain/yen";
import type { RecordTimelineRow } from "../../../src/modules/record/adapter/outbound/records-read.port";
import { ListRecordsUseCase } from "../../../src/modules/record/usecase/list-records.usecase";
import { encodeRecordsCursor } from "../../../src/modules/record/usecase/records-cursor";
import { Payment } from "../../../src/modules/record/domain/payment";
import { ACTOR, PARTNER } from "../../support/planning-context";
import {
  InMemoryRecordsReadContext,
  inMemoryRecordsReadUnitOfWork,
  PLAN_ID,
  TRIP_ID,
} from "../../support/records-context";

const PAYMENT_ID = "77777777-7777-4777-8777-000000000001";
const EVENT_ID = "66666666-6666-4666-8666-000000000001";
const BASE = new Date("2026-09-05T12:00:00.000Z");

function setup() {
  const ctx = new InMemoryRecordsReadContext();
  const uow = inMemoryRecordsReadUnitOfWork(ctx);
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
  return { ...created, id: PAYMENT_ID, createdAt: BASE, ...overrides };
}

function row(
  kind: TimelineItemKind,
  id: string,
  createdAt: Date,
  overrides: Partial<RecordTimelineRow> = {},
): RecordTimelineRow {
  return {
    id,
    tripId: TRIP_ID,
    kind,
    createdAt,
    actorId: ACTOR,
    planId: null,
    targetId: id,
    ...overrides,
  };
}

describe("記録の一覧", () => {
  it("支払い・達成とその取り消しを並べ、中身は種類の形で返す", async () => {
    const { ctx, uow } = setup();
    ctx.seedTrip();
    ctx.seedPayment(storedPayment());
    ctx.seedTimelineRow(
      row("payment", PAYMENT_ID, new Date("2026-09-05T12:00:00Z")),
    );
    ctx.seedPaymentCancellation({
      paymentId: PAYMENT_ID,
      tripId: TRIP_ID,
      cancelledBy: PARTNER,
      createdAt: new Date("2026-09-05T13:00:00Z"),
    });
    ctx.seedTimelineRow(
      row("payment_cancellation", PAYMENT_ID, new Date("2026-09-05T13:00:00Z"), {
        actorId: PARTNER,
      }),
    );
    ctx.seedTimelineRow(
      row("achievement", EVENT_ID, new Date("2026-09-05T11:00:00Z"), {
        planId: PLAN_ID,
      }),
    );
    ctx.seedPlanEventCancellation({
      eventId: EVENT_ID,
      tripId: TRIP_ID,
      cancelledBy: PARTNER,
      createdAt: new Date("2026-09-05T14:00:00Z"),
    });
    ctx.seedTimelineRow(
      row(
        "achievement_cancellation",
        EVENT_ID,
        new Date("2026-09-05T14:00:00Z"),
        { actorId: PARTNER, planId: PLAN_ID },
      ),
    );

    const result = await new ListRecordsUseCase(uow).execute({
      userId: ACTOR,
      tripId: TRIP_ID,
      type: null,
      planId: null,
      recordId: null,
      cursor: null,
      limit: null,
    });

    expect(result.items.map((item) => item.kind)).toEqual([
      "achievement_cancellation",
      "payment_cancellation",
      "payment",
      "achievement",
    ]);
    // 元の記録は種類ごとの中身、取り消しの行はCancellationの形
    expect(result.items[0]!.detail).toMatchObject({
      targetId: EVENT_ID,
      cancelledBy: PARTNER,
    });
    expect(result.items[1]!.detail).toMatchObject({
      targetId: PAYMENT_ID,
      cancelledBy: PARTNER,
    });
    expect(result.items[2]!.detail).toMatchObject({
      id: PAYMENT_ID,
      amountYen: "7001",
      cancellation: { targetId: PAYMENT_ID, cancelledBy: PARTNER },
    });
    expect(result.items[3]!.detail).toMatchObject({
      id: EVENT_ID,
      kind: "achievement",
      cancellation: { targetId: EVENT_ID, cancelledBy: PARTNER },
    });
    // 取り消しの行はidとtargetIdが同じ値（元の記録のID）
    expect(result.items[0]!.id).toBe(result.items[0]!.targetId);
    expect(result.items[0]!.id).toBe(EVENT_ID);
    expect(result.nextCursor).toBeNull();
  });

  it("limit件ずつカーソルで続きを読む（起点の行は次のページに含まれない）", async () => {
    const { ctx, uow } = setup();
    ctx.seedTrip();
    for (const [i, kind, id] of [
      [2, "payment", "77777777-7777-4777-8777-000000000003"],
      [1, "payment", "77777777-7777-4777-8777-000000000002"],
      [0, "payment", "77777777-7777-4777-8777-000000000001"],
    ] as const) {
      ctx.seedTimelineRow(
        row(kind, id, new Date(`2026-09-05T1${i}:00:00Z`)),
      );
      ctx.seedPayment(storedPayment({ id }));
    }

    const first = await new ListRecordsUseCase(uow).execute({
      userId: ACTOR,
      tripId: TRIP_ID,
      type: null,
      planId: null,
      recordId: null,
      cursor: null,
      limit: 2,
    });
    expect(first.items.map((item) => item.id)).toEqual([
      "77777777-7777-4777-8777-000000000003",
      "77777777-7777-4777-8777-000000000002",
    ]);
    expect(first.nextCursor).not.toBeNull();

    const second = await new ListRecordsUseCase(uow).execute({
      userId: ACTOR,
      tripId: TRIP_ID,
      type: null,
      planId: null,
      recordId: null,
      cursor: first.nextCursor,
      limit: 2,
    });
    expect(second.items.map((item) => item.id)).toEqual([
      "77777777-7777-4777-8777-000000000001",
    ]);
    expect(second.nextCursor).toBeNull();
  });

  it("同じ日時の元の記録と取り消しがページの境目に来ても飛ばさない（RU-04）", async () => {
    const { ctx, uow } = setup();
    ctx.seedTrip();
    const sameTime = new Date("2026-09-05T12:00:00Z");
    ctx.seedPayment(storedPayment());
    // 取り消しの行のほうが種類順では先に来る（降順でpayment_cancellation > payment）
    ctx.seedTimelineRow(
      row("payment_cancellation", PAYMENT_ID, sameTime, {
        actorId: PARTNER,
      }),
    );
    ctx.seedTimelineRow(row("payment", PAYMENT_ID, sameTime));
    ctx.seedTimelineRow(
      row("achievement", EVENT_ID, new Date("2026-09-05T11:00:00Z"), {
        planId: PLAN_ID,
      }),
    );

    const first = await new ListRecordsUseCase(uow).execute({
      userId: ACTOR,
      tripId: TRIP_ID,
      type: null,
      planId: null,
      recordId: null,
      cursor: null,
      limit: 1,
    });
    expect(first.items.map((item) => item.kind)).toEqual([
      "payment_cancellation",
    ]);

    // 次のページは同じ日時の元の記録から始まる（種類が起点を区別する）
    const second = await new ListRecordsUseCase(uow).execute({
      userId: ACTOR,
      tripId: TRIP_ID,
      type: null,
      planId: null,
      recordId: null,
      cursor: first.nextCursor,
      limit: 1,
    });
    expect(second.items.map((item) => item.kind)).toEqual(["payment"]);

    const third = await new ListRecordsUseCase(uow).execute({
      userId: ACTOR,
      tripId: TRIP_ID,
      type: null,
      planId: null,
      recordId: null,
      cursor: second.nextCursor,
      limit: 1,
    });
    expect(third.items.map((item) => item.kind)).toEqual(["achievement"]);
    expect(third.nextCursor).toBeNull();
  });

  it("別の旅行・別の絞り込みに紐付くカーソルは400", async () => {
    const { ctx, uow } = setup();
    ctx.seedTrip();
    const foreignTripCursor = encodeRecordsCursor({
      tripId: "11111111-1111-4111-8111-111111111111",
      type: null,
      planId: null,
      kind: "payment",
      id: PAYMENT_ID,
    });
    const typedCursor = encodeRecordsCursor({
      tripId: TRIP_ID,
      type: "payment",
      planId: null,
      kind: "payment",
      id: PAYMENT_ID,
    });

    for (const cursor of [foreignTripCursor, typedCursor]) {
      await expect(
        new ListRecordsUseCase(uow).execute({
          userId: ACTOR,
          tripId: TRIP_ID,
          type: null,
          planId: null,
          recordId: null,
          cursor,
          limit: null,
        }),
      ).rejects.toMatchObject({ code: "INVALID_REQUEST", status: 400 });
    }
  });

  it("起点の行が一覧に無いカーソルは400", async () => {
    const { ctx, uow } = setup();
    ctx.seedTrip();

    await expect(
      new ListRecordsUseCase(uow).execute({
        userId: ACTOR,
        tripId: TRIP_ID,
        type: null,
        planId: null,
        recordId: null,
        cursor: encodeRecordsCursor({
          tripId: TRIP_ID,
          type: null,
          planId: null,
          kind: "payment",
          id: PAYMENT_ID,
        }),
        limit: null,
      }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST", status: 400 });
  });

  it("recordIdで1件に絞る（元の記録とその取り消しの最大2件、nextCursorはnull）", async () => {
    const { ctx, uow } = setup();
    ctx.seedTrip();
    ctx.seedPayment(storedPayment());
    ctx.seedTimelineRow(
      row("payment", PAYMENT_ID, new Date("2026-09-05T12:00:00Z")),
    );
    ctx.seedTimelineRow(
      row("payment_cancellation", PAYMENT_ID, new Date("2026-09-05T13:00:00Z"), {
        actorId: PARTNER,
      }),
    );

    const result = await new ListRecordsUseCase(uow).execute({
      userId: ACTOR,
      tripId: TRIP_ID,
      type: "payment",
      planId: null,
      recordId: PAYMENT_ID,
      cursor: null,
      limit: null,
    });

    expect(result.items.map((item) => item.kind)).toEqual([
      "payment_cancellation",
      "payment",
    ]);
    expect(result.nextCursor).toBeNull();
  });

  it.each([
    { name: "type無し", input: { type: null, cursor: null, limit: null } },
    {
      name: "cursorと併用",
      input: { type: "payment" as const, cursor: "some-cursor", limit: null },
    },
    {
      name: "limitと併用",
      input: { type: "payment" as const, cursor: null, limit: 10 },
    },
  ])("recordIdの条件の組み合わせが違うときは400（$name）", async ({ input }) => {
    const { ctx, uow } = setup();
    ctx.seedTrip();

    await expect(
      new ListRecordsUseCase(uow).execute({
        userId: ACTOR,
        tripId: TRIP_ID,
        type: input.type,
        planId: null,
        recordId: PAYMENT_ID,
        cursor: input.cursor,
        limit: input.limit,
      }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST", status: 400 });
    // 条件の確認は参加者の確認の前で、一覧の照会は呼ばれない
    expect(ctx.calls).not.toContain("records.listTimeline");
  });

  it("参加していない・存在しない旅行は同じ403（存在を漏らさない）", async () => {
    const { ctx, uow } = setup();
    ctx.seedTrip();

    for (const tripId of [
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    ]) {
      await expect(
        new ListRecordsUseCase(uow).execute({
          userId: ACTOR,
          tripId,
          type: null,
          planId: null,
          recordId: null,
          cursor: null,
          limit: null,
        }),
      ).rejects.toMatchObject({ code: "TRIP_NOT_ACCESSIBLE", status: 403 });
    }
  });
});
