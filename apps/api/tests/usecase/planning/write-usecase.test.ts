import type { Trip as TripContract } from "@tomotabi/contracts";
import { describe, expect, it } from "vitest";
import type { UnitOfWork } from "../../../src/adapter/transaction/unit-of-work";
import { LocalDate } from "../../../src/common/domain/local-date";
import type { CommandReceipt } from "../../../src/common/idempotency/command-receipt";
import { CREATE_TRIP_OPERATION } from "../../../src/modules/planning/adapter/inbound/create-trip.input-port";
import { RENAME_TRIP_OPERATION } from "../../../src/modules/planning/adapter/inbound/rename-trip.input-port";
import type { PlanningWorkContext } from "../../../src/modules/planning/adapter/outbound/planning-work-context";
import { ChangeTripPeriodUseCase } from "../../../src/modules/planning/usecase/change-trip-period.usecase";
import { CreateTripUseCase } from "../../../src/modules/planning/usecase/create-trip.usecase";
import { FinishTripUseCase } from "../../../src/modules/planning/usecase/finish-trip.usecase";
import { RenameTripUseCase } from "../../../src/modules/planning/usecase/rename-trip.usecase";
import { StartTripUseCase } from "../../../src/modules/planning/usecase/start-trip.usecase";
import { isUniqueViolation } from "../../../src/modules/planning/usecase/trip-write-flow";
import {
  ACTOR,
  fixedClock,
  InMemoryPlanningContext,
  inMemoryUnitOfWork,
  KEY,
  PARTNER,
  RecordingWriteLog,
  testTrip,
} from "../../support/planning-context";

const TRIP_ID = "99999999-9999-4999-8999-999999999999";

function setup() {
  const ctx = new InMemoryPlanningContext();
  const uow = inMemoryUnitOfWork(ctx);
  const writeLog = new RecordingWriteLog();
  return { ctx, uow, writeLog };
}

function storedDto(overrides: Partial<TripContract> = {}): TripContract {
  return {
    id: TRIP_ID,
    name: "保存した名前",
    startsOn: "2026-09-10",
    endsOn: "2026-09-12",
    status: "planning",
    version: "1",
    createdAt: "2026-09-01T00:00:00.000Z",
    startedAt: null,
    finishedAt: null,
    createdBy: ACTOR,
    startedBy: null,
    finishedBy: null,
    ...overrides,
  };
}

function seedReceipt(
  ctx: InMemoryPlanningContext,
  overrides: Partial<CommandReceipt> = {},
): void {
  ctx.seedReceipt({
    actorId: ACTOR,
    operation: RENAME_TRIP_OPERATION,
    idempotencyKey: KEY,
    tripId: TRIP_ID,
    requestHash: "hash-a",
    resourceType: "trip",
    resourceId: TRIP_ID,
    httpStatus: 200,
    responseBody: storedDto(),
    ...overrides,
  });
}

function renameUsecase(uow: UnitOfWork<PlanningWorkContext>, writeLog: RecordingWriteLog) {
  return new RenameTripUseCase(uow, fixedClock(), writeLog);
}

// U-17: receiptがIf-Matchより先（F-17、N-11）
describe("receipt を If-Match より先に見る", () => {
  it("receipt あり・hash 一致で If-Match が古くても保存した結果を返す", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedTrip(testTrip({ version: 2 }), [ACTOR, PARTNER]);
    seedReceipt(ctx, { requestHash: "hash-a", responseBody: storedDto() });

    const result = await renameUsecase(uow, writeLog).execute({
      userId: ACTOR,
      tripId: TRIP_ID,
      key: KEY,
      ifMatch: "1",
      requestHash: "hash-a",
      name: "まったく別の名前",
    });

    expect(result.httpStatus).toBe(200);
    expect(result.body).toEqual(storedDto());
    expect(ctx.calls).toEqual(["trips.lockForUpdate", "receipts.find"]);
  });
});

// U-18: hashが違う同一キー（E-08）
describe("receipt の hash 不一致", () => {
  it("IDEMPOTENCY_KEY_REUSED で、保存も receipt 記録もしない", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedTrip(testTrip(), [ACTOR, PARTNER]);
    seedReceipt(ctx, { requestHash: "hash-a" });

    await expect(
      renameUsecase(uow, writeLog).execute({
        userId: ACTOR,
        tripId: TRIP_ID,
        key: KEY,
        ifMatch: "1",
        requestHash: "hash-b",
        name: "別の名前",
      }),
    ).rejects.toMatchObject({
      code: "IDEMPOTENCY_KEY_REUSED",
      status: 409,
    });
    expect(ctx.calls).toEqual(["trips.lockForUpdate", "receipts.find"]);
    expect(writeLog.entries).toEqual([
      expect.objectContaining({ result: "rejected", errorCode: "IDEMPOTENCY_KEY_REUSED" }),
    ]);
  });
});

// U-19: ロック順序（旅行 → 予定）
describe("書き込みのロック順序", () => {
  it("rename / start / finish は trips.lockForUpdate → receipts.find → trips.update → receipts.insert", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedTrip(testTrip(), [ACTOR, PARTNER]);

    await renameUsecase(uow, writeLog).execute({
      userId: ACTOR,
      tripId: TRIP_ID,
      key: KEY,
      ifMatch: "1",
      requestHash: "hash-r",
      name: "新しい名前",
    });
    expect(ctx.calls).toEqual([
      "trips.lockForUpdate",
      "receipts.find",
      "trips.update",
      "receipts.insert",
    ]);

    ctx.calls.length = 0;
    await new StartTripUseCase(uow, fixedClock(), writeLog).execute({
      userId: ACTOR,
      tripId: TRIP_ID,
      key: "22222222-2222-4222-8222-222222222222" as typeof KEY,
      ifMatch: "2",
      requestHash: "hash-s",
    });
    expect(ctx.calls).toEqual([
      "trips.lockForUpdate",
      "receipts.find",
      "trips.update",
      "receipts.insert",
    ]);

    ctx.calls.length = 0;
    await new FinishTripUseCase(uow, fixedClock(), writeLog).execute({
      userId: ACTOR,
      tripId: TRIP_ID,
      key: "33333333-3333-4333-8333-333333333333" as typeof KEY,
      ifMatch: "3",
      requestHash: "hash-f",
    });
    expect(ctx.calls).toEqual([
      "trips.lockForUpdate",
      "receipts.find",
      "trips.update",
      "receipts.insert",
    ]);
  });

  it("期間の変更は旅行行のロックのあとに予定の日付を読む", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedTrip(testTrip(), [ACTOR, PARTNER]);

    await new ChangeTripPeriodUseCase(uow, fixedClock(), writeLog).execute({
      userId: ACTOR,
      tripId: TRIP_ID,
      key: KEY,
      ifMatch: "1",
      requestHash: "hash-p",
      startsOn: "2026-09-09",
      endsOn: "2026-09-13",
    });

    expect(ctx.calls).toEqual([
      "trips.lockForUpdate",
      "receipts.find",
      "plans.datesOutside",
      "trips.update",
      "receipts.insert",
    ]);
  });

  it("作成は receipts.find → allowlist → trips.insert → insertParticipants → financeGuards.create → receipts.insert", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.allowlistRows = [
      { slot: 0, userId: ACTOR },
      { slot: 1, userId: PARTNER },
    ];

    const result = await new CreateTripUseCase(
      uow,
      fixedClock(),
      writeLog,
    ).execute({
      userId: ACTOR,
      key: KEY,
      requestHash: "hash-c",
      name: "京都 2 泊",
      startsOn: "2026-09-10",
      endsOn: "2026-09-12",
    });

    expect(result.httpStatus).toBe(201);
    expect(ctx.calls).toEqual([
      "receipts.find",
      "participants.listEnabled",
      "trips.insert",
      "trips.insertParticipants",
      "financeGuards.create",
      "receipts.insert",
    ]);
    const tripId = result.body.id;
    expect(ctx.insertedParticipants.get(tripId)).toEqual([
      { slot: 0, userId: ACTOR },
      { slot: 1, userId: PARTNER },
    ]);
    expect(ctx.guardRows).toEqual([tripId]);
  });
});

describe("書き込みの異常系", () => {
  it("VERSION_CONFLICT: If-Match が version と違う", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedTrip(testTrip({ version: 2 }), [ACTOR, PARTNER]);

    await expect(
      renameUsecase(uow, writeLog).execute({
        userId: ACTOR,
        tripId: TRIP_ID,
        key: KEY,
        ifMatch: "1",
        requestHash: "hash-v",
        name: "別名",
      }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT", status: 409 });
    expect(ctx.calls).toEqual(["trips.lockForUpdate", "receipts.find"]);
  });

  it("TRIP_NOT_ACCESSIBLE: 旅行が無いときも参加していないときも同じ 403", async () => {
    const { ctx, uow, writeLog } = setup();
    const usecase = renameUsecase(uow, writeLog);
    ctx.seedTrip(testTrip(), [PARTNER]);

    for (const tripId of [TRIP_ID, "88888888-8888-4888-8888-888888888888"]) {
      await expect(
        usecase.execute({
          userId: ACTOR,
          tripId,
          key: KEY,
          ifMatch: "1",
          requestHash: `hash-${tripId}`,
          name: "別名",
        }),
      ).rejects.toMatchObject({ code: "TRIP_NOT_ACCESSIBLE", status: 403 });
    }
  });

  it("PARTICIPANTS_NOT_READY: allowlist が 2 件未満なら 409 で行は作られない", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.allowlistRows = [{ slot: 0, userId: ACTOR }];

    await expect(
      new CreateTripUseCase(uow, fixedClock(), writeLog).execute({
        userId: ACTOR,
        key: KEY,
        requestHash: "hash-c",
        name: "京都",
        startsOn: "2026-09-10",
        endsOn: "2026-09-12",
      }),
    ).rejects.toMatchObject({ code: "PARTICIPANTS_NOT_READY", status: 409 });
    expect(ctx.tripRows.size).toBe(0);
    expect(ctx.receiptRows.size).toBe(0);
  });

  it("INVALID_TRIP_TRANSITION: finished への start は 409", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedTrip(
      testTrip({
        status: "finished",
        version: 3,
        startedAt: new Date(),
        startedBy: ACTOR,
        finishedAt: new Date(),
        finishedBy: PARTNER,
      }),
      [ACTOR, PARTNER],
    );

    await expect(
      new StartTripUseCase(uow, fixedClock(), writeLog).execute({
        userId: ACTOR,
        tripId: TRIP_ID,
        key: KEY,
        ifMatch: "3",
        requestHash: "hash-t",
      }),
    ).rejects.toMatchObject({ code: "INVALID_TRIP_TRANSITION", status: 409 });
  });

  it("PLAN_OUTSIDE_TRIP_PERIOD: 期間の外に予定があると 422", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedTrip(testTrip(), [ACTOR, PARTNER]);
    ctx.outsideDates = [LocalDate.parse("2026-09-13")];

    await expect(
      new ChangeTripPeriodUseCase(uow, fixedClock(), writeLog).execute({
        userId: ACTOR,
        tripId: TRIP_ID,
        key: KEY,
        ifMatch: "1",
        requestHash: "hash-o",
        startsOn: "2026-09-10",
        endsOn: "2026-09-12",
      }),
    ).rejects.toMatchObject({ code: "PLAN_OUTSIDE_TRIP_PERIOD", status: 422 });
  });

  it("同じ名前への rename は trips.update を呼ばないが receipt は記録する", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.seedTrip(testTrip(), [ACTOR, PARTNER]);

    const result = await renameUsecase(uow, writeLog).execute({
      userId: ACTOR,
      tripId: TRIP_ID,
      key: KEY,
      ifMatch: "1",
      requestHash: "hash-same",
      name: "京都 2 泊",
    });

    expect(result.httpStatus).toBe(200);
    expect(result.body.version).toBe("1");
    expect(ctx.calls).toEqual([
      "trips.lockForUpdate",
      "receipts.find",
      "receipts.insert",
    ]);
  });

  it("作成の同時実行で負けた側は receipt を読み直して同じ結果を返す", async () => {
    const { ctx, uow, writeLog } = setup();
    ctx.allowlistRows = [
      { slot: 0, userId: ACTOR },
      { slot: 1, userId: PARTNER },
    ];
    const stored = storedDto({ id: TRIP_ID });
    ctx.seedReceipt({
      actorId: ACTOR,
      operation: CREATE_TRIP_OPERATION,
      idempotencyKey: KEY,
      tripId: TRIP_ID,
      requestHash: "hash-c",
      resourceType: "trip",
      resourceId: TRIP_ID,
      httpStatus: 201,
      responseBody: stored,
    });
    // 最初のfindだけ空を返し、insertの23505で同時作成の負け側を再現する
    const find = ctx.receipts.find.bind(ctx.receipts);
    let findCalls = 0;
    ctx.receipts.find = (actorId, operation, key) =>
      findCalls++ === 0 ? Promise.resolve(null) : find(actorId, operation, key);

    const result = await new CreateTripUseCase(
      uow,
      fixedClock(),
      writeLog,
    ).execute({
      userId: ACTOR,
      key: KEY,
      requestHash: "hash-c",
      name: "京都 2 泊",
      startsOn: "2026-09-10",
      endsOn: "2026-09-12",
    });

    expect(result).toEqual({ httpStatus: 201, body: stored });
    expect(writeLog.entries).toEqual([
      expect.objectContaining({ result: "replayed" }),
    ]);
  });
});

describe("isUniqueViolation", () => {
  it("pg の 23505 は DrizzleQueryError の cause に包まれても一意制約違反と判定する", () => {
    const raw = Object.assign(new Error("duplicate key"), { code: "23505" });
    expect(isUniqueViolation(raw)).toBe(true);

    const wrapped = new Error("Failed query: insert");
    (wrapped as { cause?: unknown }).cause = raw;
    expect(isUniqueViolation(wrapped)).toBe(true);

    const nested = new Error("outer");
    (nested as { cause?: unknown }).cause = wrapped;
    expect(isUniqueViolation(nested)).toBe(true);

    expect(isUniqueViolation(new Error("other"))).toBe(false);
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
    expect(isUniqueViolation({ code: "57014" })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });

  it("cause が循環しても打ち切って false を返す", () => {
    const selfLoop = new Error("self loop");
    (selfLoop as { cause?: unknown }).cause = selfLoop;
    expect(isUniqueViolation(selfLoop)).toBe(false);

    const inner = new Error("inner");
    const outer = new Error("outer");
    (inner as { cause?: unknown }).cause = outer;
    (outer as { cause?: unknown }).cause = inner;
    expect(isUniqueViolation(outer)).toBe(false);
  });
});
