import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import type { TestingModule } from "@nestjs/testing";
import type { Auth } from "better-auth";
import type { TestHelpers } from "better-auth/plugins";
import { testUtils } from "better-auth/plugins";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { LocalDate } from "../../src/common/domain/local-date";
import { closePool, getPool } from "../../src/infrastructure/database/pool";
import { createAuth } from "../../src/modules/identity/infrastructure/better-auth";
import {
  HOME_READ_UNIT_OF_WORK,
  type HomeReadContext,
  type HomeReadUnitOfWork,
} from "../../src/modules/planning/adapter/outbound/home-read.port";
import { PgHomeReadUnitOfWork } from "../../src/modules/planning/infrastructure/pg-home-read.unit-of-work";
import { PgHomeRecordsRead } from "../../src/modules/record/infrastructure/pg-home-records-read";
import { PgHomeBalanceRead } from "../../src/modules/settlement/infrastructure/pg-home-balance-read";
import {
  createRoles,
  migrateAsMigrator,
  startPostgres,
  type TestDatabase,
} from "../support/database";
import { createHttpTestApp } from "../support/nest-app";

const ORIGIN = "http://localhost:3000";

const AUTH_ENV = {
  DATABASE_URL: "",
  PUBLIC_APP_ORIGIN: ORIGIN,
  BETTER_AUTH_SECRET: "test-secret-for-db-tests-only",
  GOOGLE_CLIENT_ID: "test-google-client-id",
  GOOGLE_CLIENT_SECRET: "test-google-client-secret",
};

type FixtureUser = { userId: string; sub: string };

let db: TestDatabase;
let app: NestExpressApplication;
let moduleRef: TestingModule;
let auth: Auth;
let testHelpers: TestHelpers;
let runtimePool: Pool;
let hinata: FixtureUser;
let aoi: FixtureUser;
let hinataCookie: string;

function http() {
  return request(app.getHttpServer());
}

function authed(req: request.Test, cookie: string): request.Test {
  return req
    .set("Cookie", cookie)
    .set("Origin", ORIGIN)
    .set("Content-Type", "application/json");
}

function newKey(): string {
  return crypto.randomUUID();
}

async function login(userId: string): Promise<string> {
  const result = await testHelpers.login({ userId });
  const cookie = result.headers.get("cookie");
  if (cookie === null) {
    throw new Error("login did not produce a cookie header");
  }
  return cookie;
}

async function insertUser(name: string, email: string): Promise<string> {
  const result = await db.admin.query<{ id: string }>(
    "INSERT INTO identity.users (name, email, email_verified) VALUES ($1, $2, TRUE) RETURNING id",
    [name, email],
  );
  return result.rows[0]!.id;
}

async function insertGoogleAccount(userId: string, sub: string): Promise<void> {
  await db.admin.query(
    "INSERT INTO identity.accounts (account_id, provider_id, user_id) VALUES ($1, 'google', $2)",
    [sub, userId],
  );
}

async function insertAllowlist(
  slot: number,
  userId: string,
  sub: string,
): Promise<void> {
  await db.admin.query(
    `INSERT INTO identity.allowed_google_accounts (slot, user_id, google_sub, enabled)
     VALUES ($1, $2, $3, TRUE)`,
    [slot, userId, sub],
  );
}

/** Asia/Tokyoの今日からoffset日の`YYYY-MM-DD`（APIが日本時間で今日を決める）。 */
function tokyoDate(offsetDays = 0): string {
  const now = new Date();
  const today = LocalDate.parse(
    now.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }),
  );
  const base = new Date(`${today}T00:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() + offsetDays);
  return base.toISOString().slice(0, 10);
}

async function createTrip(
  cookie: string,
  overrides: { name?: string; startsOn: string; endsOn: string },
): Promise<{ id: string; version: string }> {
  const response = await authed(http().post("/api/trips"), cookie)
    .set("Idempotency-Key", newKey())
    .send({ name: "京都 2 泊", ...overrides });
  expect(response.status).toBe(201);
  return { id: response.body.id as string, version: response.body.version as string };
}

async function createPlan(
  cookie: string,
  tripId: string,
  body: Record<string, unknown>,
): Promise<string> {
  const response = await authed(http().post(`/api/trips/${tripId}/plans`), cookie)
    .set("Idempotency-Key", newKey())
    .send(body);
  expect(response.status).toBe(201);
  return response.body.id as string;
}

async function startTrip(
  cookie: string,
  tripId: string,
  version: string,
): Promise<string> {
  const response = await authed(
    http().post(`/api/trips/${tripId}/start`),
    cookie,
  )
    .set("Idempotency-Key", newKey())
    .set("If-Match", `"${version}"`);
  expect(response.status).toBe(200);
  return response.body.version as string;
}

async function finishTrip(
  cookie: string,
  tripId: string,
  version: string,
): Promise<string> {
  const response = await authed(
    http().post(`/api/trips/${tripId}/finish`),
    cookie,
  )
    .set("Idempotency-Key", newKey())
    .set("If-Match", `"${version}"`);
  expect(response.status).toBe(200);
  return response.body.version as string;
}

async function createPayment(
  cookie: string,
  tripId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const response = await authed(
    http().post(`/api/trips/${tripId}/payments`),
    cookie,
  )
    .set("Idempotency-Key", newKey())
    .send({
      amountYen: "7001",
      payerUserId: hinata.userId,
      allocations: [
        { userId: hinata.userId, percent: 50 },
        { userId: aoi.userId, percent: 50 },
      ],
      ...overrides,
    });
  expect(response.status).toBe(201);
  return response.body.id as string;
}

async function getHome(cookie: string, tripId: string): Promise<request.Response> {
  return authed(http().get(`/api/trips/${tripId}/home`), cookie);
}

/** 旅行の参加者でない・存在しない旅行を別利用者2人で直接作る。 */
async function seedForeignTrip(): Promise<string> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const u0 = await insertUser(`foreign-${suffix}-0`, `foreign-${suffix}-0@example.test`);
  const u1 = await insertUser(`foreign-${suffix}-1`, `foreign-${suffix}-1@example.test`);
  const trip = await db.admin.query<{ id: string }>(
    "INSERT INTO planning.trips (name, starts_on, ends_on, created_by) VALUES ('関係ない旅行', '2026-10-01', '2026-10-02', $1) RETURNING id",
    [u0],
  );
  const tripId = trip.rows[0]!.id;
  await db.admin.query(
    "INSERT INTO planning.trip_participants (trip_id, slot, user_id) VALUES ($1, 0, $2), ($1, 1, $3)",
    [tripId, u0, u1],
  );
  return tripId;
}

beforeAll(async () => {
  db = await startPostgres();
  await createRoles(db);
  await migrateAsMigrator(db);

  AUTH_ENV.DATABASE_URL = db.urlFor("app_runtime");
  for (const [key, value] of Object.entries(AUTH_ENV)) {
    process.env[key] = value;
  }

  runtimePool = getPool();
  for (const pool of [runtimePool, db.admin]) {
    pool.on("error", () => {});
  }
  auth = createAuth(
    {
      baseURL: ORIGIN,
      secret: AUTH_ENV.BETTER_AUTH_SECRET,
      googleClientId: AUTH_ENV.GOOGLE_CLIENT_ID,
      googleClientSecret: AUTH_ENV.GOOGLE_CLIENT_SECRET,
      useSecureCookies: false,
    },
    runtimePool,
    { plugins: [testUtils()] },
  );
  testHelpers = ((await auth.$context) as unknown as { test: TestHelpers })
    .test;

  moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  app = await createHttpTestApp(moduleRef, auth);

  const hinataId = await insertUser("ひなた", "hinata@example.test");
  hinata = { userId: hinataId, sub: "test-sub-0" };
  await insertGoogleAccount(hinata.userId, hinata.sub);
  await insertAllowlist(0, hinata.userId, hinata.sub);
  const aoiId = await insertUser("あおい", "aoi@example.test");
  aoi = { userId: aoiId, sub: "test-sub-1" };
  await insertGoogleAccount(aoi.userId, aoi.sub);
  await insertAllowlist(1, aoi.userId, aoi.sub);

  hinataCookie = await login(hinata.userId);
});

afterAll(async () => {
  await app?.close();
  await closePool();
  await db?.stop();
  for (const key of Object.keys(AUTH_ENV)) {
    delete process.env[key];
  }
});

describe("ホームの読み取りは同じ時点のデータを見る（RD-15）", () => {
  it("1つのトランザクションの途中で別接続がコミットした行は後の欄にも見えない", async () => {
    const { id: tripId } = await createTrip(hinataCookie, {
      startsOn: tokyoDate(-1),
      endsOn: tokyoDate(1),
    });
    await createPlan(hinataCookie, tripId, {
      name: "清水寺",
      kind: "place",
      date: tokyoDate(0),
    });
    const paymentId = await createPayment(hinataCookie, tripId);

    const uow = new PgHomeReadUnitOfWork(
      runtimePool,
      (tx) => new PgHomeRecordsRead(tx as never),
      (tx) => new PgHomeBalanceRead(tx as never),
    );
    const today = LocalDate.parse(tokyoDate(0));
    const seen = await uow.run(async (ctx: HomeReadContext) => {
      const tripRow = await ctx.trip.find(tripId, hinata.userId);
      if (tripRow === null) {
        throw new Error("trip not readable");
      }
      const before = await ctx.schedule.listForDay(tripId, today);
      // 同じスナップショットの読み取りの途中で、別接続が予定・支払い・
      // 記録を追加してコミットする。
      await db.admin.query(
        "INSERT INTO planning.plans (trip_id, name, kind, planned_date) VALUES ($1, '追加された予定', 'place', $2)",
        [tripId, today],
      );
      await db.admin.query(
        `INSERT INTO record.payments (trip_id, amount_yen, payer_slot, slot0_percent,
           slot0_burden_yen, slot1_burden_yen, contribution_yen, created_by)
         VALUES ($1, 100000, 1, 50, 50000, 50000, -50000, $2)`,
        [tripId, aoi.userId],
      );
      const after = await ctx.schedule.listForDay(tripId, today);
      const records = await ctx.records.listRecent(tripId, tripRow.roster);
      const balance = await ctx.balance.findSummary(tripId, tripRow.roster);
      return { before, after, records, balance };
    });

    // 別接続のコミットはこのトランザクションのどの欄からも見えない。
    expect(seen.after.length).toBe(seen.before.length);
    expect(seen.before.length).toBe(1);
    expect(seen.records).toHaveLength(1);
    expect(seen.records[0]!.id).toBe(paymentId);
    // 追加された支払い（100000円、aoi支払い）は残額に現れない。
    expect(seen.balance).toMatchObject({
      transfer: {
        signedTotalYen: "3500",
        amountYen: "3500",
        fromUserId: aoi.userId,
        toUserId: hinata.userId,
        requiresTransfer: true,
      },
      targetCount: 1,
    });
  });
});

describe("ホームの4つの表示の種類（RD-16）", () => {
  it("before: 出発前の旅行は初日の予定と出発までの日数を返す", async () => {
    const { id: tripId } = await createTrip(hinataCookie, {
      startsOn: tokyoDate(2),
      endsOn: tokyoDate(4),
    });
    const planId = await createPlan(hinataCookie, tripId, {
      name: "清水寺",
      kind: "place",
      date: tokyoDate(2),
      time: "09:00",
    });

    const response = await getHome(hinataCookie, tripId);

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.body.context).toMatchObject({
      mode: "before",
      targetDate: tokyoDate(2),
      dayNumber: null,
      daysUntilStart: 2,
      suggestedAction: null,
    });
    const schedule = response.body.schedule;
    expect(schedule.status).toBe("ok");
    expect(schedule.data.date).toBe(tokyoDate(2));
    expect(schedule.data.items.map((item: { id: string }) => item.id)).toEqual([
      planId,
    ]);
    expect(response.body.recentRecords.status).toBe("ok");
    expect(response.body.balance.status).toBe("ok");
  });

  it("during: 期間中の旅行は今日の予定と何日目かを返す", async () => {
    const { id: tripId } = await createTrip(hinataCookie, {
      startsOn: tokyoDate(-1),
      endsOn: tokyoDate(1),
    });
    const todayPlan = await createPlan(hinataCookie, tripId, {
      name: "今日の昼食",
      kind: "food",
      date: tokyoDate(0),
    });
    // 違う日の予定は今日の欄に出ない。
    await createPlan(hinataCookie, tripId, {
      name: "明日の宿",
      kind: "lodging",
      date: tokyoDate(1),
    });

    const response = await getHome(hinataCookie, tripId);

    expect(response.status).toBe(200);
    expect(response.body.context).toMatchObject({
      mode: "during",
      targetDate: tokyoDate(0),
      dayNumber: 2,
      daysUntilStart: null,
      suggestedAction: "start",
    });
    const schedule = response.body.schedule;
    expect(schedule.status).toBe("ok");
    expect(schedule.data.items.map((item: { id: string }) => item.id)).toEqual([
      todayPlan,
    ]);
    expect(schedule.data.totalCount).toBe(1);
    expect(schedule.data.achievedCount).toBe(0);
  });

  it("after_dates: 期間が過ぎた未終了の旅行は予定の欄をnullにする", async () => {
    const { id: tripId, version } = await createTrip(hinataCookie, {
      startsOn: tokyoDate(-3),
      endsOn: tokyoDate(-1),
    });
    await startTrip(hinataCookie, tripId, version);

    const response = await getHome(hinataCookie, tripId);

    expect(response.status).toBe(200);
    expect(response.body.context).toMatchObject({
      mode: "after_dates",
      targetDate: null,
      dayNumber: null,
      daysUntilStart: null,
      suggestedAction: "finish",
    });
    expect(response.body.schedule).toEqual({ status: "ok", data: null });
    // 期間が過ぎても精算と最近の記録の欄は出る。
    expect(response.body.balance.status).toBe("ok");
    expect(response.body.recentRecords.status).toBe("ok");
  });

  it("completed: 終了した旅行は日付に関わらず予定の欄をnullにする", async () => {
    const { id: tripId, version } = await createTrip(hinataCookie, {
      startsOn: tokyoDate(-1),
      endsOn: tokyoDate(1),
    });
    const started = await startTrip(hinataCookie, tripId, version);
    await finishTrip(hinataCookie, tripId, started);

    const response = await getHome(hinataCookie, tripId);

    expect(response.status).toBe(200);
    expect(response.body.context).toMatchObject({
      mode: "completed",
      targetDate: null,
      suggestedAction: null,
    });
    expect(response.body.schedule).toEqual({ status: "ok", data: null });
    expect(response.body.trip.status).toBe("finished");
  });

  it("計画中のまま期間中に入った旅行は「旅行を開始」を案内する", async () => {
    const { id: tripId } = await createTrip(hinataCookie, {
      startsOn: tokyoDate(0),
      endsOn: tokyoDate(1),
    });
    const response = await getHome(hinataCookie, tripId);
    expect(response.status).toBe(200);
    expect(response.body.context).toMatchObject({
      mode: "during",
      dayNumber: 1,
      suggestedAction: "start",
    });
  });
});

describe("ホームの精算の欄（RD-17）", () => {
  it("対象が無い旅行は0円・0件を返す", async () => {
    const { id: tripId } = await createTrip(hinataCookie, {
      startsOn: tokyoDate(0),
      endsOn: tokyoDate(1),
    });
    const response = await getHome(hinataCookie, tripId);
    expect(response.status).toBe(200);
    expect(response.body.balance).toEqual({
      status: "ok",
      data: {
        transfer: {
          signedTotalYen: "0",
          amountYen: "0",
          fromUserId: null,
          toUserId: null,
          requiresTransfer: false,
        },
        targetCount: 0,
      },
    });
  });

  it("未精算の支払いがある旅行は受け渡しの向き・金額・件数を返す", async () => {
    const { id: tripId } = await createTrip(hinataCookie, {
      startsOn: tokyoDate(0),
      endsOn: tokyoDate(1),
    });
    // ひなたが7001円を半々で立て替え → あおいが3500円をひなたへ。
    await createPayment(hinataCookie, tripId);

    const response = await getHome(hinataCookie, tripId);

    expect(response.status).toBe(200);
    expect(response.body.balance).toEqual({
      status: "ok",
      data: {
        transfer: {
          signedTotalYen: "3500",
          amountYen: "3500",
          fromUserId: aoi.userId,
          toUserId: hinata.userId,
          requiresTransfer: true,
        },
        targetCount: 1,
      },
    });
  });

  it("互いに同額の支払いがあれば差し引き0円でも対象件数は残る", async () => {
    const { id: tripId } = await createTrip(hinataCookie, {
      startsOn: tokyoDate(0),
      endsOn: tokyoDate(1),
    });
    await createPayment(hinataCookie, tripId, {
      amountYen: "7000",
      payerUserId: hinata.userId,
    });
    await createPayment(hinataCookie, tripId, {
      amountYen: "7000",
      payerUserId: aoi.userId,
    });

    const response = await getHome(hinataCookie, tripId);

    expect(response.status).toBe(200);
    expect(response.body.balance).toEqual({
      status: "ok",
      data: {
        transfer: {
          signedTotalYen: "0",
          amountYen: "0",
          fromUserId: null,
          toUserId: null,
          requiresTransfer: false,
        },
        targetCount: 2,
      },
    });
  });
});

describe("ホームの欄の失敗と権限（RD-18）", () => {
  /**
   * 欄の読み取りに偽の失敗を差し込む。UoWを包んで、指定した欄の
   * 読み取りがerrorを投げる文脈に入れ替える。呼び出し側で元に戻す。
   */
  function withFailingSection(
    section: "trip" | "schedule" | "balance" | "recentRecords",
    error: Error,
  ): () => void {
    const uow = moduleRef.get<HomeReadUnitOfWork>(HOME_READ_UNIT_OF_WORK);
    const real = uow.run.bind(uow);
    const originalRun = uow.run;
    uow.run = <T>(work: (ctx: HomeReadContext) => Promise<T>): Promise<T> =>
      real((ctx) =>
        work({
          ...ctx,
          trip:
            section === "trip"
              ? { find: () => Promise.reject(error) }
              : ctx.trip,
          schedule:
            section === "schedule"
              ? { listForDay: () => Promise.reject(error) }
              : ctx.schedule,
          balance:
            section === "balance"
              ? { findSummary: () => Promise.reject(error) }
              : ctx.balance,
          records:
            section === "recentRecords"
              ? { listRecent: () => Promise.reject(error) }
              : ctx.records,
        }),
      );
    return () => {
      uow.run = originalRun;
    };
  }

  it("欄の読み取りが回復できる誤りで失敗したらその欄だけ unavailable・ほかの欄は返る", async () => {
    const { id: tripId } = await createTrip(hinataCookie, {
      startsOn: tokyoDate(-1),
      endsOn: tokyoDate(1),
    });
    await createPlan(hinataCookie, tripId, {
      name: "清水寺",
      kind: "place",
      date: tokyoDate(0),
    });
    await createPayment(hinataCookie, tripId);

    // 精算の欄だけ、直列化の失敗（40001。回復できる誤り）を差し込む。
    const restore = withFailingSection(
      "balance",
      Object.assign(new Error("serialization failure"), { code: "40001" }),
    );
    try {
      const response = await getHome(hinataCookie, tripId);
      expect(response.status).toBe(200);
      expect(response.body.balance).toEqual({
        status: "unavailable",
        code: "TEMPORARILY_UNAVAILABLE",
      });
      // 失敗した金額を0円に置き換えない。ほかの欄は返る。
      expect(response.body.schedule.status).toBe("ok");
      expect(response.body.recentRecords.status).toBe("ok");
      expect(response.body.recentRecords.data).toHaveLength(1);
    } finally {
      restore();
    }
  });

  it("欄の読み取りが接続断で失敗したら欄ごとに分けず全体が503", async () => {
    const { id: tripId } = await createTrip(hinataCookie, {
      startsOn: tokyoDate(-1),
      endsOn: tokyoDate(1),
    });
    const restore = withFailingSection(
      "schedule",
      Object.assign(new Error("connection failure"), { code: "08006" }),
    );
    try {
      const response = await getHome(hinataCookie, tripId);
      expect(response.status).toBe(503);
      expect(response.body.code).toBe("TEMPORARILY_UNAVAILABLE");
    } finally {
      restore();
    }
  });

  it("旅行の読み取りが失敗したら欄の失敗とは別に全体が503", async () => {
    const { id: tripId } = await createTrip(hinataCookie, {
      startsOn: tokyoDate(0),
      endsOn: tokyoDate(1),
    });
    const restore = withFailingSection(
      "trip",
      Object.assign(new Error("connection failure"), { code: "08006" }),
    );
    try {
      const response = await getHome(hinataCookie, tripId);
      expect(response.status).toBe(503);
    } finally {
      restore();
    }
  });

  it("参加していない・存在しない旅行は同じ403で、権限を漏らさない", async () => {
    const foreignTripId = await seedForeignTrip();
    const foreign = await getHome(hinataCookie, foreignTripId);
    const missing = await getHome(hinataCookie, crypto.randomUUID());
    expect(foreign.status).toBe(403);
    expect(missing.status).toBe(403);
    expect(foreign.body.code).toBe(missing.body.code);
  });

  it("認証なしは401", async () => {
    const { id: tripId } = await createTrip(hinataCookie, {
      startsOn: tokyoDate(0),
      endsOn: tokyoDate(1),
    });
    const response = await http()
      .get(`/api/trips/${tripId}/home`)
      .set("Origin", ORIGIN);
    expect(response.status).toBe(401);
  });
});

describe("ホームのキャッシュと性能（RD-19のホーム分）", () => {
  it("支払い200件・達成と予約200件の旅行のホームが1秒以内に返り、Cache-Controlを持つ", async () => {
    const { id: tripId } = await createTrip(hinataCookie, {
      startsOn: tokyoDate(-1),
      endsOn: tokyoDate(1),
    });
    const planId = await createPlan(hinataCookie, tripId, {
      name: "清水寺",
      kind: "place",
      date: tokyoDate(0),
    });
    await db.admin.query(
      `INSERT INTO record.payments (trip_id, amount_yen, payer_slot, slot0_percent,
         slot0_burden_yen, slot1_burden_yen, contribution_yen, created_by, created_at)
       SELECT $1, 7001, 0, 50, 3501, 3500, 3500, $2,
              '2026-09-01T00:00:00Z'::timestamptz + (g || ' seconds')::interval
         FROM generate_series(1, 200) g`,
      [tripId, hinata.userId],
    );
    await db.admin.query(
      `INSERT INTO record.plan_events (trip_id, plan_id, event_kind, created_by, created_at)
       SELECT $1, $2, CASE WHEN g % 2 = 0 THEN 'achievement' ELSE 'booking' END,
              $3, '2026-09-01T00:00:00Z'::timestamptz + (g || ' seconds')::interval
         FROM generate_series(1, 200) g`,
      [tripId, planId, hinata.userId],
    );

    const started = performance.now();
    const response = await getHome(hinataCookie, tripId);
    const elapsed = performance.now() - started;

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.body.recentRecords.status).toBe("ok");
    expect(response.body.recentRecords.data).toHaveLength(3);
    expect(response.body.schedule.status).toBe("ok");
    expect(response.body.balance.status).toBe("ok");
    expect(elapsed).toBeLessThan(1000);
  });
});
