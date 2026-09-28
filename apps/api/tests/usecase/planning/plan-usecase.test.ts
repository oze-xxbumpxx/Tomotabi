import type { Plan as PlanContract } from "@tomotabi/contracts";
import { describe, expect, it } from "vitest";
import type { Clock } from "../../../src/adapter/clock/clock";
import type { UnitOfWork } from "../../../src/adapter/transaction/unit-of-work";
import { LocalDate } from "../../../src/common/domain/local-date";
import type { CommandReceipt } from "../../../src/common/idempotency/command-receipt";
import { UPDATE_PLAN_OPERATION } from "../../../src/modules/planning/adapter/inbound/update-plan.input-port";
import type { PlanningReadPort } from "../../../src/modules/planning/adapter/outbound/planning-read.port";
import type { PlanningWorkContext } from "../../../src/modules/planning/adapter/outbound/planning-work-context";
import { CancelPlanUseCase } from "../../../src/modules/planning/usecase/cancel-plan.usecase";
import { CreatePlanUseCase } from "../../../src/modules/planning/usecase/create-plan.usecase";
import { GetItineraryUseCase } from "../../../src/modules/planning/usecase/get-itinerary.usecase";
import { MovePlanUseCase } from "../../../src/modules/planning/usecase/move-plan.usecase";
import { UpdatePlanUseCase } from "../../../src/modules/planning/usecase/update-plan.usecase";
import {
  ACTOR,
  fixedClock,
  InMemoryPlanningContext,
  inMemoryUnitOfWork,
  KEY,
  PARTNER,
  RecordingWriteLog,
  testPlan,
  testTrip,
} from "../../support/planning-context";

const TRIP_ID = "99999999-9999-4999-8999-999999999999";
const PLAN_ID = "88888888-8888-4888-8888-888888888888";

function setup() {
  const ctx = new InMemoryPlanningContext();
  const uow = inMemoryUnitOfWork(ctx);
  const writeLog = new RecordingWriteLog();
  ctx.seedTrip(testTrip(), [ACTOR, PARTNER]);
  ctx.seedPlan(testPlan());
  return { ctx, uow, writeLog };
}

function storedPlan(overrides: Partial<PlanContract> = {}): PlanContract {
  return {
    id: PLAN_ID,
    tripId: TRIP_ID,
    name: "清水寺",
    kind: "place",
    date: "2026-09-11",
    time: null,
    memo: null,
    cancelledAt: null,
    cancelledBy: null,
    version: "1",
    achievement: null,
    booking: null,
    canChangeKind: true,
    kindChangeReason: null,
    ...overrides,
  };
}

function seedPlanReceipt(
  ctx: InMemoryPlanningContext,
  overrides: Partial<CommandReceipt> = {},
): void {
  ctx.seedReceipt({
    actorId: ACTOR,
    operation: UPDATE_PLAN_OPERATION,
    idempotencyKey: KEY,
    tripId: TRIP_ID,
    requestHash: "hash-a",
    resourceType: "plan",
    resourceId: PLAN_ID,
    httpStatus: 200,
    responseBody: storedPlan(),
    ...overrides,
  });
}

function updateUsecase(
  uow: UnitOfWork<PlanningWorkContext>,
  writeLog: RecordingWriteLog,
) {
  return new UpdatePlanUseCase(uow, fixedClock(), writeLog);
}

// U-19: 予定の書き込みも 旅行 → receipt → 予定 の順（設計書「書き込みの共通の流れ」）
describe("予定の書き込みの呼び出し順", () => {
  it("更新は trips.lockForShare → receipts.find → plans.lockForUpdate → plans.update → receipts.insert", async () => {
    const { ctx, uow, writeLog } = setup();

    await updateUsecase(uow, writeLog).execute({
      userId: ACTOR,
      tripId: TRIP_ID,
      planId: PLAN_ID,
      key: KEY,
      ifMatch: "1",
      requestHash: "hash-u",
      name: "伏見稲荷",
      kind: undefined,
      time: undefined,
      memo: undefined,
    });

    // hasHistory（ロック中の E-19 照会）と応答用の activeEvents / hasHistory が挟まる
    expect(ctx.calls).toEqual([
      "trips.lockForShare",
      "receipts.find",
      "plans.lockForUpdate",
      "plans.update",
      "recordHistory.activeEvents",
      "recordHistory.hasHistory",
      "receipts.insert",
    ]);
  });

  it("種類が変わる更新は plans.lockForUpdate のあとに recordHistory.hasHistory を呼ぶ（E-19）", async () => {
    const { ctx, uow, writeLog } = setup();

    await updateUsecase(uow, writeLog).execute({
      userId: ACTOR,
      tripId: TRIP_ID,
      planId: PLAN_ID,
      key: KEY,
      ifMatch: "1",
      requestHash: "hash-k",
      name: undefined,
      kind: "food",
      time: undefined,
      memo: undefined,
    });

    const historyCall = ctx.calls.indexOf("recordHistory.hasHistory");
    const planLock = ctx.calls.indexOf("plans.lockForUpdate");
    const planUpdate = ctx.calls.indexOf("plans.update");
    expect(historyCall).toBeGreaterThan(planLock);
    expect(historyCall).toBeLessThan(planUpdate);
  });

  it("作成は trips.lockForShare → receipts.find → plans.insert → receipts.insert", async () => {
    const { ctx, uow, writeLog } = setup();

    await new CreatePlanUseCase(uow, fixedClock(), writeLog).execute({
      userId: ACTOR,
      tripId: TRIP_ID,
      key: KEY,
      requestHash: "hash-c",
      name: "金閣寺",
      kind: "place",
      date: "2026-09-10",
      time: null,
      memo: null,
    });

    expect(ctx.calls).toEqual([
      "trips.lockForShare",
      "receipts.find",
      "plans.insert",
      "receipts.insert",
    ]);
  });
});

describe("予定の書き込みの異常系", () => {
  it("receipt あり・hash 一致で If-Match が古くても保存した結果を返す", async () => {
    const { ctx, uow, writeLog } = setup();
    seedPlanReceipt(ctx, { responseBody: storedPlan({ version: "3" }) });

    const result = await updateUsecase(uow, writeLog).execute({
      userId: ACTOR,
      tripId: TRIP_ID,
      planId: PLAN_ID,
      key: KEY,
      ifMatch: "1",
      requestHash: "hash-a",
      name: "別名",
      kind: undefined,
      time: undefined,
      memo: undefined,
    });

    expect(result.httpStatus).toBe(200);
    expect(result.body.version).toBe("3");
    expect(ctx.calls).toEqual(["trips.lockForShare", "receipts.find"]);
  });

  it("VERSION_CONFLICT: If-Match が version と違う", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedPlan(testPlan({ version: 2 }));

    await expect(
      updateUsecase(uow, writeLog).execute({
        userId: ACTOR,
        tripId: TRIP_ID,
        planId: PLAN_ID,
        key: KEY,
        ifMatch: "1",
        requestHash: "hash-v",
        name: "別名",
        kind: undefined,
        time: undefined,
        memo: undefined,
      }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT", status: 409 });
  });

  it("PLAN_NOT_FOUND: 予定が無い・別の旅行の予定は同じ 404", async () => {
    const { ctx, uow, writeLog } = setup();
    const otherTripPlan = testPlan({ id: "abababab-abab-4bab-abab-abababababab", tripId: "cccccccc-cccc-4ccc-cccc-cccccccccccc" });
    ctx.seedPlan(otherTripPlan);

    for (const planId of [otherTripPlan.id, "dddddddd-dddd-4ddd-dddd-dddddddddddd"]) {
      await expect(
        updateUsecase(uow, writeLog).execute({
          userId: ACTOR,
          tripId: TRIP_ID,
          planId,
          key: KEY,
          ifMatch: "1",
          requestHash: `hash-${planId}`,
          name: "別名",
          kind: undefined,
          time: undefined,
          memo: undefined,
        }),
      ).rejects.toMatchObject({ code: "PLAN_NOT_FOUND", status: 404 });
    }
  });

  it("PLAN_HAS_RECORD_HISTORY: 履歴のある予定の種類変更は 409", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedHistory(PLAN_ID);

    await expect(
      updateUsecase(uow, writeLog).execute({
        userId: ACTOR,
        tripId: TRIP_ID,
        planId: PLAN_ID,
        key: KEY,
        ifMatch: "1",
        requestHash: "hash-h",
        name: undefined,
        kind: "food",
        time: undefined,
        memo: undefined,
      }),
    ).rejects.toMatchObject({ code: "PLAN_HAS_RECORD_HISTORY", status: 409 });
    expect(ctx.planRows.get(PLAN_ID)?.kind).toBe("place");
  });

  it("PLAN_CANCELLED: 取りやめ済みの再取りやめは 409", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedPlan(
      testPlan({
        cancelledAt: new Date("2026-09-06T00:00:00.000Z"),
        cancelledBy: PARTNER,
        version: 2,
      }),
    );

    await expect(
      new CancelPlanUseCase(uow, fixedClock(), writeLog).execute({
        userId: ACTOR,
        tripId: TRIP_ID,
        planId: PLAN_ID,
        key: KEY,
        ifMatch: "2",
        requestHash: "hash-x",
      }),
    ).rejects.toMatchObject({ code: "PLAN_CANCELLED", status: 409 });
  });

  it("PLAN_OUTSIDE_TRIP_PERIOD: 期間外への移動は 422 で日付も変わらない", async () => {
    const { ctx, uow, writeLog } = setup();

    await expect(
      new MovePlanUseCase(uow, fixedClock(), writeLog).execute({
        userId: ACTOR,
        tripId: TRIP_ID,
        planId: PLAN_ID,
        key: KEY,
        ifMatch: "1",
        requestHash: "hash-m",
        date: "2026-09-13",
      }),
    ).rejects.toMatchObject({ code: "PLAN_OUTSIDE_TRIP_PERIOD", status: 422 });
    expect(ctx.planRows.get(PLAN_ID)?.date).toBe("2026-09-11");
  });

  it("同じ値への更新は plans.update を呼ばないが receipt は記録する", async () => {
    const { ctx, uow, writeLog } = setup();

    const result = await updateUsecase(uow, writeLog).execute({
      userId: ACTOR,
      tripId: TRIP_ID,
      planId: PLAN_ID,
      key: KEY,
      ifMatch: "1",
      requestHash: "hash-same",
      name: "清水寺",
      kind: undefined,
      time: undefined,
      memo: undefined,
    });

    expect(result.httpStatus).toBe(200);
    expect(result.body.version).toBe("1");
    expect(ctx.calls).not.toContain("plans.update");
    expect(ctx.calls.at(-1)).toBe("receipts.insert");
  });
});

// U-20: しおりの既定の日付（F-16、N-10）
describe("しおりの日付の決まり方", () => {
  function readableStub(seenDates: LocalDate[]): PlanningReadPort {
    const trip = testTrip();
    return {
      findTripForParticipant: () => Promise.resolve(trip),
      findTripAnchor: () => Promise.resolve(null),
      listTripsForParticipant: () =>
        Promise.resolve({ items: [], nextCursor: null }),
      findPlanInTrip: () => Promise.resolve(null),
      listPlansForDay: (_tripId, date) => {
        seenDates.push(date);
        return Promise.resolve([]);
      },
    };
  }

  function clockToday(today: string): Clock {
    return {
      now: () => new Date("2026-09-05T12:00:00.000Z"),
      today: () => LocalDate.parse(today),
    };
  }

  it("省略時は日本時間の今日が期間内なら今日になる", async () => {
    const seenDates: LocalDate[] = [];
    const usecase = new GetItineraryUseCase(
      readableStub(seenDates),
      clockToday("2026-09-11"),
    );
    const result = await usecase.execute({
      userId: ACTOR,
      tripId: TRIP_ID,
      date: null,
    });
    expect(result.date).toBe("2026-09-11");
    expect(seenDates).toEqual(["2026-09-11"]);
  });

  it.each(["2026-09-05", "2026-09-20"])(
    "今日（%s）が期間外なら初日になる",
    async (today) => {
      const seenDates: LocalDate[] = [];
      const usecase = new GetItineraryUseCase(
        readableStub(seenDates),
        clockToday(today),
      );
      const result = await usecase.execute({
        userId: ACTOR,
        tripId: TRIP_ID,
        date: null,
      });
      expect(result.date).toBe("2026-09-10");
    },
  );

  it("明示した期間内の日付はその日を使う", async () => {
    const seenDates: LocalDate[] = [];
    const usecase = new GetItineraryUseCase(
      readableStub(seenDates),
      clockToday("2026-09-11"),
    );
    const result = await usecase.execute({
      userId: ACTOR,
      tripId: TRIP_ID,
      date: "2026-09-12",
    });
    expect(result.date).toBe("2026-09-12");
  });

  it("明示した期間外の日付は 422", async () => {
    const usecase = new GetItineraryUseCase(
      readableStub([]),
      clockToday("2026-09-11"),
    );
    await expect(
      usecase.execute({ userId: ACTOR, tripId: TRIP_ID, date: "2026-09-13" }),
    ).rejects.toMatchObject({ code: "PLAN_OUTSIDE_TRIP_PERIOD", status: 422 });
  });

  it("実在しない日付は 422 VALIDATION_FAILED", async () => {
    const usecase = new GetItineraryUseCase(
      readableStub([]),
      clockToday("2026-09-11"),
    );
    await expect(
      usecase.execute({ userId: ACTOR, tripId: TRIP_ID, date: "2026-02-30" }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED", status: 422 });
  });
});
