import { describe, expect, it } from "vitest";
import type { UnitOfWork } from "../../../src/adapter/transaction/unit-of-work";
import type { IdempotencyKey } from "../../../src/common/http/idempotency-key";
import type { CommandReceipt } from "../../../src/common/idempotency/command-receipt";
import { createPlanEventOperation } from "../../../src/modules/record/adapter/inbound/create-plan-event.input-port";
import { cancelPlanEventOperation } from "../../../src/modules/record/adapter/inbound/cancel-plan-event.input-port";
import type { PlanEventWorkContext } from "../../../src/modules/record/adapter/outbound/plan-event-work-context";
import type {
  PlanEvent,
  PlanEventCancellation,
  PlanEventKind,
} from "../../../src/modules/record/domain/plan-event";
import { CancelPlanEventUseCase } from "../../../src/modules/record/usecase/cancel-plan-event.usecase";
import { CreatePlanEventUseCase } from "../../../src/modules/record/usecase/create-plan-event.usecase";
import {
  ACTOR,
  KEY,
  PARTNER,
  RecordingWriteLog,
} from "../../support/planning-context";
import {
  InMemoryPlanEventContext,
  inMemoryPlanEventUnitOfWork,
  PLAN_ID,
  TRIP_ID,
} from "../../support/plan-event-context";

const OTHER_TRIP_ID = "11111111-1111-4111-8111-111111111111";
// 生成される記録id（77777777-…）と衝突しないシード用のid
const EVENT_ID = "33333333-3333-4333-8333-333333333333";

function setup() {
  const ctx = new InMemoryPlanEventContext();
  const uow = inMemoryPlanEventUnitOfWork(ctx);
  const writeLog = new RecordingWriteLog();
  return { ctx, uow, writeLog };
}

function createUsecase(
  uow: UnitOfWork<PlanEventWorkContext>,
  writeLog: RecordingWriteLog,
) {
  return new CreatePlanEventUseCase(uow, writeLog);
}

function cancelUsecase(
  uow: UnitOfWork<PlanEventWorkContext>,
  writeLog: RecordingWriteLog,
) {
  return new CancelPlanEventUseCase(uow, writeLog);
}

function createInput(
  overrides: Partial<{
    eventKind: PlanEventKind;
    planId: string;
    key: IdempotencyKey;
    requestHash: string;
  }> = {},
) {
  return {
    userId: ACTOR,
    tripId: TRIP_ID,
    eventKind: "achievement" as PlanEventKind,
    planId: PLAN_ID,
    key: KEY,
    requestHash: "hash-a",
    ...overrides,
  };
}

function storedEvent(
  overrides: Partial<PlanEvent> = {},
): PlanEvent {
  return {
    id: EVENT_ID,
    tripId: TRIP_ID,
    planId: PLAN_ID,
    kind: "achievement",
    createdBy: ACTOR,
    createdAt: new Date("2026-09-05T12:00:00.000Z"),
    ...overrides,
  };
}

function storedCancellation(
  overrides: Partial<PlanEventCancellation> = {},
): PlanEventCancellation {
  return {
    eventId: EVENT_ID,
    tripId: TRIP_ID,
    cancelledBy: ACTOR,
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
    requestHash: "hash-a",
    resourceType: "plan_event",
    resourceId: EVENT_ID,
    httpStatus: 201,
    responseBody: { stored: true },
    ...overrides,
  };
}

// RU-02: 達成・予約を付けるUseCase（決まり・受領・409とexistingRecordId）
describe("達成・予約を付けるUseCaseの流れ（RU-02）", () => {
  it("付けは trips.lockForShare → receipts.find → planEligibility.lockForUpdate → findActiveId → insert → insertActive → receipts.insert の順", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedTrip();
    ctx.seedPlan(PLAN_ID, TRIP_ID, "place");

    const result = await createUsecase(uow, writeLog).execute(createInput());

    expect(result.httpStatus).toBe(201);
    expect(result.body.kind).toBe("achievement");
    expect(result.body.cancellation).toBeNull();
    expect(ctx.calls).toEqual([
      "trips.lockForShare",
      "receipts.find",
      "planEligibility.lockForUpdate",
      "planEvents.findActiveId",
      "planEvents.insert",
      "planEvents.insertActive",
      "receipts.insert",
    ]);
    expect(writeLog.entries).toEqual([
      expect.objectContaining({ result: "created", resourceId: result.body.id }),
    ]);
  });

  it("receiptに残っている再送は対象を読まずに保存した結果を返す", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedTrip();
    ctx.seedPlan(PLAN_ID, TRIP_ID, "place");
    const stored = { id: EVENT_ID, note: "receipt の中身" };
    ctx.seedReceipt(
      receiptOf(createPlanEventOperation("achievement"), {
        responseBody: stored,
      }),
    );

    const result = await createUsecase(uow, writeLog).execute(createInput());

    expect(result).toEqual({ httpStatus: 201, body: stored });
    expect(ctx.calls).toEqual(["trips.lockForShare", "receipts.find"]);
    expect(writeLog.entries).toEqual([
      expect.objectContaining({ result: "replayed", resourceId: EVENT_ID }),
    ]);
  });

  it("同じキーで内容が違う再送は409 IDEMPOTENCY_KEY_REUSED", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedTrip();
    ctx.seedPlan(PLAN_ID, TRIP_ID, "place");
    ctx.seedReceipt(receiptOf(createPlanEventOperation("achievement")));

    await expect(
      createUsecase(uow, writeLog).execute(
        createInput({ requestHash: "hash-of-different-plan" }),
      ),
    ).rejects.toMatchObject({
      code: "IDEMPOTENCY_KEY_REUSED",
      status: 409,
    });
    expect(ctx.calls).toEqual(["trips.lockForShare", "receipts.find"]);
  });

  it("参加していない旅行は予定の照会の前に403で止まる", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedTrip(OTHER_TRIP_ID);

    await expect(
      createUsecase(uow, writeLog).execute(createInput()),
    ).rejects.toMatchObject({ code: "TRIP_NOT_ACCESSIBLE", status: 403 });
    expect(ctx.calls).toEqual(["trips.lockForShare"]);
    expect(writeLog.entries.at(-1)).toMatchObject({
      result: "rejected",
      errorCode: "TRIP_NOT_ACCESSIBLE",
    });
  });

  it("旅行に無い予定は404 PLAN_NOT_FOUND", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedTrip();
    ctx.seedPlan(PLAN_ID, OTHER_TRIP_ID, "place");

    await expect(
      createUsecase(uow, writeLog).execute(createInput()),
    ).rejects.toMatchObject({ code: "PLAN_NOT_FOUND", status: 404 });
    expect(ctx.calls).toEqual([
      "trips.lockForShare",
      "receipts.find",
      "planEligibility.lockForUpdate",
    ]);
    expect(ctx.eventRows.size).toBe(0);
  });

  it("種類に合わない予定は409 PLAN_KIND_NOT_SUPPORTED、取りやめた予定への達成は409 PLAN_CANCELLED", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedTrip();
    ctx.seedPlan(PLAN_ID, TRIP_ID, "lodging");
    ctx.seedPlan("22222222-2222-4222-8222-222222222222", TRIP_ID, "place",
      new Date("2026-09-03T00:00:00.000Z"));
    const usecase = createUsecase(uow, writeLog);

    await expect(
      usecase.execute(createInput()),
    ).rejects.toMatchObject({ code: "PLAN_KIND_NOT_SUPPORTED", status: 409 });
    await expect(
      usecase.execute(
        createInput({ planId: "22222222-2222-4222-8222-222222222222" }),
      ),
    ).rejects.toMatchObject({ code: "PLAN_CANCELLED", status: 409 });
    expect(ctx.eventRows.size).toBe(0);
    expect(ctx.receiptRows.size).toBe(0);
  });

  it("取りやめた予定への予約は付けられる（予約は取りやめ可）", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedTrip();
    ctx.seedPlan(PLAN_ID, TRIP_ID, "lodging",
      new Date("2026-09-03T00:00:00.000Z"));

    const result = await createUsecase(uow, writeLog).execute(
      createInput({ eventKind: "booking" }),
    );

    expect(result.httpStatus).toBe(201);
    expect(result.body.kind).toBe("booking");
  });

  it("有効な記録がある予定は409 RECORD_ALREADY_ACTIVEで既存の記録idを返す", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedTrip();
    // foodは達成・予約の両方を付けられる種類
    ctx.seedPlan(PLAN_ID, TRIP_ID, "food");
    ctx.seedEvent(storedEvent());
    ctx.seedActive(PLAN_ID, "achievement", EVENT_ID);

    await expect(
      createUsecase(uow, writeLog).execute(createInput()),
    ).rejects.toMatchObject({
      code: "RECORD_ALREADY_ACTIVE",
      status: 409,
      details: { existingRecordId: EVENT_ID },
    });
    // 種類が違えば別の記録として付けられる（同じ予定に達成と予約は共存する）
    const booking = await createUsecase(uow, writeLog).execute(
      createInput({ eventKind: "booking" }),
    );
    expect(booking.httpStatus).toBe(201);
    expect(ctx.eventRows.size).toBe(2);
  });

  it("占有行の主キー違反（別の接続が先に足した）は409 RECORD_ALREADY_ACTIVE", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedTrip();
    ctx.seedPlan(PLAN_ID, TRIP_ID, "place");
    const winnerEvent = storedEvent({ id: EVENT_ID });
    ctx.seedEvent(winnerEvent);
    ctx.failActiveInsertTimes = 1;
    ctx.winningActiveOnFailure = {
      planId: PLAN_ID,
      kind: "achievement",
      eventId: EVENT_ID,
    };

    await expect(
      createUsecase(uow, writeLog).execute(createInput()),
    ).rejects.toMatchObject({
      code: "RECORD_ALREADY_ACTIVE",
      status: 409,
      details: { existingRecordId: EVENT_ID },
    });
  });

  it("受領の一意違反で負けたら勝った側の受領を読み直す（hashが同じならその結果）", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedTrip();
    ctx.seedPlan(PLAN_ID, TRIP_ID, "place");
    const stored = { id: EVENT_ID, note: "勝った側の受領" };
    ctx.winningReceiptOnFailure = receiptOf(
      createPlanEventOperation("achievement"),
      { responseBody: stored },
    );
    ctx.failReceiptInsertTimes = 1;

    const result = await createUsecase(uow, writeLog).execute(createInput());
    expect(result).toEqual({ httpStatus: 201, body: stored });
    expect(writeLog.entries.at(-1)).toMatchObject({
      result: "replayed",
      resourceId: EVENT_ID,
    });
  });
});

// RU-03: 達成・予約を取り消すUseCase（種類違い404・同じ取り消しの再送）
describe("達成・予約を取り消すUseCase（RU-03）", () => {
  it("取り消しは trips.lockForShare → receipts.find → findInTrip → planEligibility.lockForUpdate → findCancellationInTrip → insertCancellation → deleteActive → receipts.insert の順", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedTrip();
    ctx.seedPlan(PLAN_ID, TRIP_ID, "place");
    ctx.seedEvent(storedEvent());
    ctx.seedActive(PLAN_ID, "achievement", EVENT_ID);

    const result = await cancelUsecase(uow, writeLog).execute({
      userId: ACTOR,
      tripId: TRIP_ID,
      eventKind: "achievement",
      recordId: EVENT_ID,
      key: KEY,
      requestHash: "hash-x",
    });

    expect(result.httpStatus).toBe(201);
    expect(result.body).toMatchObject({ targetId: EVENT_ID });
    expect(ctx.calls).toEqual([
      "trips.lockForShare",
      "receipts.find",
      "planEvents.findInTrip",
      "planEligibility.lockForUpdate",
      "planEvents.findCancellationInTrip",
      "planEvents.insertCancellation",
      "planEvents.deleteActive",
      "receipts.insert",
    ]);
    // 占有行は消えるが、元の記録の行は残る
    expect(ctx.activeRows.size).toBe(0);
    expect(ctx.eventRows.has(EVENT_ID)).toBe(true);
  });

  it("既に取り消した記録は今ある取り消しを200で返す（別キーの再取り消し）", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedTrip();
    ctx.seedPlan(PLAN_ID, TRIP_ID, "place");
    ctx.seedEvent(storedEvent());
    ctx.seedActive(PLAN_ID, "achievement", EVENT_ID);

    await cancelUsecase(uow, writeLog).execute({
      userId: ACTOR,
      tripId: TRIP_ID,
      eventKind: "achievement",
      recordId: EVENT_ID,
      key: KEY,
      requestHash: "hash-1",
    });
    ctx.calls.length = 0;
    const again = await cancelUsecase(uow, writeLog).execute({
      userId: PARTNER,
      tripId: TRIP_ID,
      eventKind: "achievement",
      recordId: EVENT_ID,
      key: "22222222-2222-4222-8222-222222222222" as IdempotencyKey,
      requestHash: "hash-2",
    });

    expect(again.httpStatus).toBe(200);
    expect(again.body.targetId).toBe(EVENT_ID);
    expect(ctx.calls).toEqual([
      "trips.lockForShare",
      "receipts.find",
      "planEvents.findInTrip",
      "planEligibility.lockForUpdate",
      "planEvents.findCancellationInTrip",
      "receipts.insert",
    ]);
    expect(ctx.cancellationRows.size).toBe(1);
  });

  it("URLの種類と記録の種類が違う・別の旅行・無い記録は同じ404 RECORD_NOT_FOUND", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedTrip();
    ctx.seedPlan(PLAN_ID, TRIP_ID, "place");
    ctx.seedEvent(storedEvent({ kind: "booking" }));
    ctx.seedTrip(OTHER_TRIP_ID);
    ctx.seedEvent(
      storedEvent({ id: "66666666-6666-4666-8666-666666666666", tripId: OTHER_TRIP_ID }),
    );
    const usecase = cancelUsecase(uow, writeLog);

    // 記録はbookingだがURLはachievements
    await expect(
      usecase.execute({
        userId: ACTOR,
        tripId: TRIP_ID,
        eventKind: "achievement",
        recordId: EVENT_ID,
        key: KEY,
        requestHash: "hash-x",
      }),
    ).rejects.toMatchObject({ code: "RECORD_NOT_FOUND", status: 404 });
    // 別の旅行の記録
    await expect(
      usecase.execute({
        userId: ACTOR,
        tripId: TRIP_ID,
        eventKind: "achievement",
        recordId: "66666666-6666-4666-8666-666666666666",
        key: KEY,
        requestHash: "hash-y",
      }),
    ).rejects.toMatchObject({ code: "RECORD_NOT_FOUND", status: 404 });
    // 無い記録
    await expect(
      usecase.execute({
        userId: ACTOR,
        tripId: TRIP_ID,
        eventKind: "achievement",
        recordId: "55555555-5555-4555-8555-555555555555",
        key: KEY,
        requestHash: "hash-z",
      }),
    ).rejects.toMatchObject({ code: "RECORD_NOT_FOUND", status: 404 });
    expect(ctx.cancellationRows.size).toBe(0);
  });

  it("同じキーの取り消しの再送は保存した結果を返す（対象を読まない）", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedTrip();
    const stored = { targetId: EVENT_ID, note: "receipt の中身" };
    ctx.seedReceipt(
      receiptOf(cancelPlanEventOperation("achievement"), {
        resourceType: "plan_event_cancellation",
        responseBody: stored,
      }),
    );

    const result = await cancelUsecase(uow, writeLog).execute({
      userId: ACTOR,
      tripId: TRIP_ID,
      eventKind: "achievement",
      recordId: EVENT_ID,
      key: KEY,
      requestHash: "hash-a",
    });

    expect(result).toEqual({ httpStatus: 201, body: stored });
    expect(ctx.calls).toEqual(["trips.lockForShare", "receipts.find"]);
  });

  it("付け直した記録は古い取り消しの再送で消えない（deleteActiveはevent_idでだけ消す）", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedTrip();
    ctx.seedPlan(PLAN_ID, TRIP_ID, "place");
    ctx.seedEvent(storedEvent({ id: EVENT_ID }));
    // 最初の記録は取り消し済み（占有行は無い）
    ctx.seedCancellation(storedCancellation());
    // 付け直した新しい記録が有効
    const renewedId = "44444444-4444-4444-8444-444444444444";
    ctx.seedEvent(storedEvent({ id: renewedId }));
    ctx.seedActive(PLAN_ID, "achievement", renewedId);

    const again = await cancelUsecase(uow, writeLog).execute({
      userId: PARTNER,
      tripId: TRIP_ID,
      eventKind: "achievement",
      recordId: EVENT_ID,
      key: "33333333-3333-4333-8333-333333333333" as IdempotencyKey,
      requestHash: "hash-old-cancel",
    });

    expect(again.httpStatus).toBe(200);
    // 古い記録の取り消しの再送は、付け直した新しい記録の占有行を消さない
    expect(ctx.activeRows.get(`${PLAN_ID}|achievement`)).toBe(renewedId);
    expect(ctx.cancellationRows.size).toBe(1);
  });
});

describe("書き込みログに入力の中身を出さない", () => {
  it("作成・拒否どちらのエントリも定めた鍵だけを持つ", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedTrip();
    ctx.seedPlan(PLAN_ID, TRIP_ID, "place");
    await createUsecase(uow, writeLog).execute(createInput());
    await expect(
      createUsecase(uow, writeLog).execute(
        createInput({
          planId: "55555555-5555-4555-8555-555555555555",
          key: "44444444-4444-4444-8444-444444444444" as IdempotencyKey,
          requestHash: "hash-d",
        }),
      ),
    ).rejects.toMatchObject({ code: "PLAN_NOT_FOUND" });

    for (const entry of writeLog.entries) {
      expect(Object.keys(entry).sort()).toEqual(
        ["durationMs", "errorCode", "operation", "resourceId", "result", "tripId"].sort(),
      );
    }
    const serialized = JSON.stringify(writeLog.entries);
    expect(serialized).not.toContain(KEY);
    expect(serialized).not.toContain(PLAN_ID);
  });
});
