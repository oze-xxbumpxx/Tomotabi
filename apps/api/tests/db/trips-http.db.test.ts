import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import type { Auth } from "better-auth";
import type { TestHelpers } from "better-auth/plugins";
import { testUtils } from "better-auth/plugins";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UnitOfWork } from "../../src/adapter/transaction/unit-of-work";
import { AppModule } from "../../src/app.module";
import { closePool, getPool } from "../../src/infrastructure/database/pool";
import { PgParticipantsQuery } from "../../src/modules/identity/infrastructure/pg-participants.query";
import type { ParticipantsPort } from "../../src/modules/planning/adapter/outbound/participants.port";
import {
  PLANNING_UNIT_OF_WORK,
  type PlanningWorkContext,
} from "../../src/modules/planning/adapter/outbound/planning-work-context";
import { PgPlanningUnitOfWork } from "../../src/modules/planning/infrastructure/pg-planning-unit-of-work";
import { PgRecordHistoryQuery } from "../../src/modules/record/infrastructure/pg-record-history.query";
import { createAuth } from "../../src/modules/identity/infrastructure/better-auth";
import {
  createRoles,
  migrateAsMigrator,
  startPostgres,
  type TestDatabase,
} from "../support/database";
import { createHttpTestApp } from "../support/nest-app";

const ORIGIN = "http://localhost:3000";
const EVIL_ORIGIN = "http://evil.example.test";

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
let auth: Auth;
let testHelpers: TestHelpers;
let runtimePool: Pool;
let hinata: FixtureUser;
let aoi: FixtureUser;
let hinataCookie: string;
let aoiCookie: string;

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

type TableCounts = {
  trips: number;
  participants: number;
  guards: number;
  receipts: number;
};

async function tableCounts(): Promise<TableCounts> {
  const count = async (table: string): Promise<number> =>
    Number(
      (
        await db.admin.query<{ c: string }>(
          `SELECT count(*)::text AS c FROM ${table}`,
        )
      ).rows[0]!.c,
    );
  return {
    trips: await count("planning.trips"),
    participants: await count("planning.trip_participants"),
    guards: await count("infra.trip_finance_guards"),
    receipts: await count("infra.command_receipts"),
  };
}

async function postTrip(
  cookie: string,
  body: unknown,
  key = newKey(),
): Promise<request.Response> {
  return authed(http().post("/api/trips"), cookie)
    .set("Idempotency-Key", key)
    .send(body);
}

const TRIP_BODY = { name: "京都 2 泊", startsOn: "2026-09-10", endsOn: "2026-09-12" };

async function createTrip(cookie: string, name = "京都 2 泊"): Promise<string> {
  const response = await postTrip(cookie, { ...TRIP_BODY, name });
  expect(response.status).toBe(201);
  return response.body.id as string;
}

/** ひなたが参加しない旅行を別利用者2人で直接作る（T-07・T-09用）。 */
async function seedForeignTrip(): Promise<string> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const u0 = await insertUser(`foreign-${suffix}-0`, `foreign-${suffix}-0@example.test`);
  const u1 = await insertUser(`foreign-${suffix}-1`, `foreign-${suffix}-1@example.test`);
  const result = await db.admin.query<{ id: string }>(
    "INSERT INTO planning.trips (name, starts_on, ends_on, created_by) VALUES ('関係ない旅行', '2026-10-01', '2026-10-02', $1) RETURNING id",
    [u0],
  );
  const tripId = result.rows[0]!.id;
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

  const moduleRef = await Test.createTestingModule({
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
  aoiCookie = await login(aoi.userId);
}, 120_000);

afterAll(async () => {
  await app?.close();
  await closePool();
  await db?.stop();
  for (const key of Object.keys(AUTH_ENV)) {
    delete process.env[key];
  }
});

describe("作成（T-01〜T-06）", () => {
  it("T-01: 201・ETag・DTO、参加者 2 行・guard 1 行・receipt 1 行", async () => {
    const response = await postTrip(hinataCookie, TRIP_BODY, newKey());

    expect(response.status).toBe(201);
    expect(response.headers.etag).toBe('"1"');
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.body).toMatchObject({
      name: "京都 2 泊",
      startsOn: "2026-09-10",
      endsOn: "2026-09-12",
      status: "planning",
      version: "1",
      createdBy: hinata.userId,
      startedAt: null,
      finishedAt: null,
      startedBy: null,
      finishedBy: null,
    });
    const tripId = response.body.id as string;
    expect(Date.parse(response.body.createdAt)).not.toBeNaN();

    const participants = await db.admin.query(
      "SELECT slot, user_id FROM planning.trip_participants WHERE trip_id = $1 ORDER BY slot",
      [tripId],
    );
    expect(participants.rows).toEqual([
      { slot: 0, user_id: hinata.userId },
      { slot: 1, user_id: aoi.userId },
    ]);

    const guard = await db.admin.query<{ c: string }>(
      "SELECT count(*)::text AS c FROM infra.trip_finance_guards WHERE trip_id = $1",
      [tripId],
    );
    expect(guard.rows[0]!.c).toBe("1");

    const receipts = await db.admin.query(
      "SELECT operation, http_status, resource_type, resource_id FROM infra.command_receipts WHERE trip_id = $1",
      [tripId],
    );
    expect(receipts.rows).toEqual([
      {
        operation: "createTrip",
        http_status: 201,
        resource_type: "trip",
        resource_id: tripId,
      },
    ]);
  });

  it("T-02: allowlist が 1 人だけ / 一方が enabled=false だと 409 で行も増えない", async () => {
    const before = await tableCounts();

    await db.admin.query(
      "DELETE FROM identity.allowed_google_accounts WHERE slot = 1",
    );
    try {
      const response = await postTrip(hinataCookie, TRIP_BODY);
      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({ code: "PARTICIPANTS_NOT_READY" });
    } finally {
      await insertAllowlist(1, aoi.userId, aoi.sub);
    }
    expect(await tableCounts()).toEqual(before);

    await db.admin.query(
      "UPDATE identity.allowed_google_accounts SET enabled = FALSE WHERE slot = 1",
    );
    try {
      const response = await postTrip(hinataCookie, TRIP_BODY);
      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({ code: "PARTICIPANTS_NOT_READY" });
    } finally {
      await db.admin.query(
        "UPDATE identity.allowed_google_accounts SET enabled = TRUE WHERE slot = 1",
      );
    }
    expect(await tableCounts()).toEqual(before);
  });

  it("T-03: guard の INSERT に失敗したら trips・参加者・guard・receipt すべて戻る", async () => {
    const realUoW = new PgPlanningUnitOfWork(
      runtimePool,
      (db): ParticipantsPort => new PgParticipantsQuery(db as NodePgDatabase),
      (db) => new PgRecordHistoryQuery(db as NodePgDatabase),
    );
    const failingUoW: UnitOfWork<PlanningWorkContext> = {
      run: (work) =>
        realUoW.run((ctx) =>
          work({
            ...ctx,
            financeGuards: {
              create: () => Promise.reject(new Error("injected guard failure")),
            },
          }),
        ),
    };
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PLANNING_UNIT_OF_WORK)
      .useValue(failingUoW)
      .compile();
    const failApp = await createHttpTestApp(moduleRef, auth);
    try {
      const before = await tableCounts();
      const response = await authed(
        request(failApp.getHttpServer()).post("/api/trips"),
        hinataCookie,
      )
        .set("Idempotency-Key", newKey())
        .send(TRIP_BODY);

      expect(response.status).toBe(500);
      expect(response.body).toMatchObject({ code: "INTERNAL_ERROR" });
      expect(await tableCounts()).toEqual(before);
    } finally {
      await failApp.close();
    }
  });

  it("T-04: 同じキー・同じ body の再送は同じ DTO・ETag で行が増えない", async () => {
    const key = newKey();
    const first = await postTrip(hinataCookie, TRIP_BODY, key);
    expect(first.status).toBe(201);
    const before = await tableCounts();

    const replay = await postTrip(hinataCookie, TRIP_BODY, key);
    expect(replay.status).toBe(201);
    expect(replay.body).toEqual(first.body);
    expect(replay.headers.etag).toBe(first.headers.etag);
    expect(await tableCounts()).toEqual(before);
  });

  it("T-05: 同じキーで違う body は 409 IDEMPOTENCY_KEY_REUSED", async () => {
    const key = newKey();
    const first = await postTrip(hinataCookie, TRIP_BODY, key);
    expect(first.status).toBe(201);

    const response = await postTrip(
      hinataCookie,
      { ...TRIP_BODY, name: "別の旅行" },
      key,
    );
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
  });

  it("T-06: 同じキー・同じ body の同時作成は旅行 1 件・両方 201・同じ id", async () => {
    const key = newKey();
    const before = await tableCounts();
    const [first, second] = await Promise.all([
      postTrip(hinataCookie, TRIP_BODY, key),
      postTrip(hinataCookie, TRIP_BODY, key),
    ]);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.id).toBe(first.body.id);

    const after = await tableCounts();
    expect(after.trips).toBe(before.trips + 1);
    expect(after.guards).toBe(before.guards + 1);
    expect(after.receipts).toBe(before.receipts + 1);
    expect(after.participants).toBe(before.participants + 2);
  });
});

describe("一覧と取得（T-07〜T-09）", () => {
  it("T-07: 自分の旅行だけを新しい順で返し、同時刻は id の降順", async () => {
    const foreignTripId = await seedForeignTrip();
    const t1 = await createTrip(hinataCookie, "旅行 1");
    const t2 = await createTrip(hinataCookie, "旅行 2");
    const t3 = await createTrip(hinataCookie, "旅行 3");

    // 他の試験で作った旅行より先頭に来るよう、created_atを未来の既知の値にする
    await db.admin.query(
      "UPDATE planning.trips SET created_at = '2027-01-01T10:00:00Z' WHERE id = $1",
      [t1],
    );
    await db.admin.query(
      "UPDATE planning.trips SET created_at = '2027-01-03T10:00:00Z' WHERE id = $1",
      [t2],
    );
    await db.admin.query(
      "UPDATE planning.trips SET created_at = '2027-01-03T10:00:00Z' WHERE id = $1",
      [t3],
    );
    // 同時刻の2件はidの降順になる
    const tieOrder = [t2, t3].sort().reverse();

    const response = await authed(http().get("/api/trips"), hinataCookie);
    expect(response.status).toBe(200);
    const ids = (response.body.items as { id: string }[]).map((item) => item.id);
    expect(ids.slice(0, 3)).toEqual([tieOrder[0], tieOrder[1], t1]);
    expect(ids).not.toContain(foreignTripId);
  });

  it("T-08: 25 件を limit=20 → nextCursor で続き、status 絞り込み、limit=51 と改ざんカーソルは 400", async () => {
    const foreignTripId = await seedForeignTrip();
    const created: string[] = [];
    for (let i = 0; i < 25; i += 1) {
      created.push(await createTrip(aoiCookie, `旅行 ${String(i).padStart(2, "0")}`));
    }

    const allIds: string[] = [];
    let cursor: string | null = null;
    let firstPage = true;
    do {
      const url =
        cursor === null
          ? "/api/trips?limit=20"
          : `/api/trips?limit=20&cursor=${encodeURIComponent(cursor)}`;
      const page = await authed(http().get(url), aoiCookie);
      expect(page.status).toBe(200);
      expect(page.body.items.length).toBeGreaterThan(0);
      if (firstPage) {
        expect(page.body.items).toHaveLength(20);
        expect(page.body.nextCursor).not.toBeNull();
        firstPage = false;
      }
      allIds.push(
        ...(page.body.items as { id: string }[]).map((item) => item.id),
      );
      cursor = page.body.nextCursor;
    } while (cursor !== null);

    // ページをまたいで重複なく、作った25件が全部含まれ、参加しない旅行は出ない
    expect(new Set(allIds).size).toBe(allIds.length);
    for (const id of created) {
      expect(allIds).toContain(id);
    }
    expect(allIds).not.toContain(foreignTripId);

    // 絞り込み: 3件をfinishedにする（ライフサイクル制約上の必須列も合わせて）
    const finished = created.slice(0, 3);
    await db.admin.query(
      `UPDATE planning.trips
         SET status = 'finished', started_at = '2026-09-11T00:00:00Z', started_by = $2,
             finished_at = '2026-09-12T00:00:00Z', finished_by = $2
       WHERE id = ANY($1::uuid[])`,
      [finished, aoi.userId],
    );
    const filtered = await authed(
      http().get("/api/trips?status=finished"),
      aoiCookie,
    );
    expect(filtered.status).toBe(200);
    expect(filtered.body.items).toHaveLength(3);
    for (const item of filtered.body.items as { id: string; status: string }[]) {
      expect(item.status).toBe("finished");
      expect(finished).toContain(item.id);
    }

    const tooLarge = await authed(
      http().get("/api/trips?limit=51"),
      aoiCookie,
    );
    expect(tooLarge.status).toBe(400);
    expect(tooLarge.body).toMatchObject({ code: "INVALID_REQUEST" });

    const tampered = await authed(
      http().get("/api/trips?cursor=not-a-real-cursor"),
      aoiCookie,
    );
    expect(tampered.status).toBe(400);
    expect(tampered.body).toMatchObject({ code: "INVALID_REQUEST" });

    // 同じミリ秒・違うマイクロ秒の3件を足す。カーソルがミリ秒に丸まると
    // ページの境目でこれらが抜け落ちる。finishedにしてlimit=1でたどる。
    const microIds: string[] = [];
    for (const micro of ["123900", "123500", "123100"]) {
      const id = await createTrip(aoiCookie, `sub-ms ${micro}`);
      await db.admin.query(
        `UPDATE planning.trips
           SET created_at = $2::timestamptz, status = 'finished',
               started_at = '2026-09-11T00:00:00Z', started_by = $3,
               finished_at = '2026-09-12T00:00:00Z', finished_by = $3
         WHERE id = $1`,
        [id, `2027-02-01T00:00:00.${micro}Z`, aoi.userId],
      );
      microIds.push(id);
    }
    const seen: string[] = [];
    let microCursor: string | null = null;
    for (let page = 0; page < 20 && (page === 0 || microCursor !== null); page += 1) {
      const url =
        microCursor === null
          ? "/api/trips?status=finished&limit=1"
          : `/api/trips?status=finished&limit=1&cursor=${encodeURIComponent(microCursor)}`;
      const response = await authed(http().get(url), aoiCookie);
      expect(response.status).toBe(200);
      expect(response.body.items).toHaveLength(1);
      seen.push((response.body.items as { id: string }[])[0]!.id);
      microCursor = response.body.nextCursor;
    }
    expect(microCursor).toBeNull();
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.sort()).toEqual([...finished, ...microIds].sort());
  });

  it("T-09: 取得は 200＋ETag。参加しない・存在しないはどちらも同じ 403 本文", async () => {
    const own = await createTrip(hinataCookie, "自分の旅行");
    const ok = await authed(http().get(`/api/trips/${own}`), hinataCookie);
    expect(ok.status).toBe(200);
    expect(ok.headers.etag).toBe('"1"');
    expect(ok.headers["cache-control"]).toBe("private, no-store");
    expect(ok.body.id).toBe(own);

    const foreignTripId = await seedForeignTrip();
    const missingId = crypto.randomUUID();
    const foreign = await authed(
      http().get(`/api/trips/${foreignTripId}`),
      hinataCookie,
    );
    const missing = await authed(
      http().get(`/api/trips/${missingId}`),
      hinataCookie,
    );
    for (const response of [foreign, missing]) {
      expect(response.status).toBe(403);
      expect(response.body.code).toBe("TRIP_NOT_ACCESSIBLE");
    }
    // 存在しない・参加していないで本文が同じ（requestIdは要求ごとに違う）
    const { requestId: _f, ...foreignBody } = foreign.body;
    const { requestId: _m, ...missingBody } = missing.body;
    expect(foreignBody).toEqual(missingBody);
  });
});

describe("名前・期間の変更と If-Match（T-10〜T-12）", () => {
  it("T-10: PATCH 名は 200 で ETag が上がる", async () => {
    const tripId = await createTrip(hinataCookie);

    const response = await authed(
      http().patch(`/api/trips/${tripId}`),
      hinataCookie,
    )
      .set("Idempotency-Key", newKey())
      .set("If-Match", '"1"')
      .send({ name: "沖縄 3 泊" });

    expect(response.status).toBe(200);
    expect(response.headers.etag).toBe('"2"');
    expect(response.body).toMatchObject({ name: "沖縄 3 泊", version: "2" });
  });

  it("T-11: If-Match なしは 428、古い値は 409 で名前は変わらない", async () => {
    const tripId = await createTrip(hinataCookie);
    await authed(http().patch(`/api/trips/${tripId}`), hinataCookie)
      .set("Idempotency-Key", newKey())
      .set("If-Match", '"1"')
      .send({ name: "一度目の名前" });

    const noIfMatch = await authed(
      http().patch(`/api/trips/${tripId}`),
      hinataCookie,
    )
      .set("Idempotency-Key", newKey())
      .send({ name: "二度目" });
    expect(noIfMatch.status).toBe(428);
    expect(noIfMatch.body).toMatchObject({ code: "IF_MATCH_REQUIRED" });

    const stale = await authed(
      http().patch(`/api/trips/${tripId}`),
      hinataCookie,
    )
      .set("Idempotency-Key", newKey())
      .set("If-Match", '"1"')
      .send({ name: "二度目" });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ code: "VERSION_CONFLICT" });

    const current = await authed(http().get(`/api/trips/${tripId}`), hinataCookie);
    expect(current.body.name).toBe("一度目の名前");
  });

  it("T-12: 取りやめ済みを含む予定が外れる期間は 422、含む期間は成功", async () => {
    const tripId = await createTrip(hinataCookie);
    await db.admin.query(
      "INSERT INTO planning.plans (trip_id, name, kind, planned_date) VALUES ($1, '清水寺', 'place', '2026-09-11')",
      [tripId],
    );
    await db.admin.query(
      `INSERT INTO planning.plans (trip_id, name, kind, planned_date, cancelled_at, cancelled_by)
       VALUES ($1, '取りやめた予定', 'food', '2026-09-12', now(), $2)`,
      [tripId, hinata.userId],
    );

    // 取りやめ済みの予定（2026-09-12）がはみ出す期間 → 422で何も変わらない
    const shrink = await authed(
      http().put(`/api/trips/${tripId}/period`),
      hinataCookie,
    )
      .set("Idempotency-Key", newKey())
      .set("If-Match", '"1"')
      .send({ startsOn: "2026-09-10", endsOn: "2026-09-11" });
    expect(shrink.status).toBe(422);
    expect(shrink.body).toMatchObject({ code: "PLAN_OUTSIDE_TRIP_PERIOD" });

    const current = await authed(http().get(`/api/trips/${tripId}`), hinataCookie);
    expect(current.body).toMatchObject({ startsOn: "2026-09-10", endsOn: "2026-09-12", version: "1" });

    // 全予定を含む期間 → 200
    const widen = await authed(
      http().put(`/api/trips/${tripId}/period`),
      hinataCookie,
    )
      .set("Idempotency-Key", newKey())
      .set("If-Match", '"1"')
      .send({ startsOn: "2026-09-01", endsOn: "2026-09-20" });
    expect(widen.status).toBe(200);
    expect(widen.body).toMatchObject({ startsOn: "2026-09-01", endsOn: "2026-09-20", version: "2" });
  });
});

describe("開始・終了（T-13〜T-16）", () => {
  it("T-13: start → finish で状態と日時・実行者が記録される", async () => {
    const tripId = await createTrip(hinataCookie);

    const started = await authed(
      http().post(`/api/trips/${tripId}/start`),
      hinataCookie,
    )
      .set("Idempotency-Key", newKey())
      .set("If-Match", '"1"');
    expect(started.status).toBe(200);
    expect(started.body).toMatchObject({
      status: "traveling",
      version: "2",
      startedBy: hinata.userId,
    });
    expect(started.body.startedAt).not.toBeNull();

    const finished = await authed(
      http().post(`/api/trips/${tripId}/finish`),
      aoiCookie,
    )
      .set("Idempotency-Key", newKey())
      .set("If-Match", '"2"');
    expect(finished.status).toBe(200);
    expect(finished.body).toMatchObject({
      status: "finished",
      version: "3",
      finishedBy: aoi.userId,
    });
    expect(Date.parse(finished.body.finishedAt)).toBeGreaterThanOrEqual(
      Date.parse(finished.body.startedAt),
    );
  });

  it("T-14: finished→start / planning→finish は 409 INVALID_TRIP_TRANSITION", async () => {
    const planningTrip = await createTrip(hinataCookie);
    const earlyFinish = await authed(
      http().post(`/api/trips/${planningTrip}/finish`),
      hinataCookie,
    )
      .set("Idempotency-Key", newKey())
      .set("If-Match", '"1"');
    expect(earlyFinish.status).toBe(409);
    expect(earlyFinish.body).toMatchObject({ code: "INVALID_TRIP_TRANSITION" });

    const finishedTrip = await createTrip(hinataCookie);
    await authed(http().post(`/api/trips/${finishedTrip}/start`), hinataCookie)
      .set("Idempotency-Key", newKey())
      .set("If-Match", '"1"');
    await authed(http().post(`/api/trips/${finishedTrip}/finish`), hinataCookie)
      .set("Idempotency-Key", newKey())
      .set("If-Match", '"2"');
    const restart = await authed(
      http().post(`/api/trips/${finishedTrip}/start`),
      hinataCookie,
    )
      .set("Idempotency-Key", newKey())
      .set("If-Match", '"3"');
    expect(restart.status).toBe(409);
    expect(restart.body).toMatchObject({ code: "INVALID_TRIP_TRANSITION" });
  });

  it("T-15: 同じ状態への遷移は version・started_at が変わらず、再送も同じ結果", async () => {
    const tripId = await createTrip(hinataCookie);
    await authed(http().post(`/api/trips/${tripId}/start`), hinataCookie)
      .set("Idempotency-Key", newKey())
      .set("If-Match", '"1"');
    const before = await authed(http().get(`/api/trips/${tripId}`), hinataCookie);

    // 別のキーでstart（ETagは現在値に一致）
    const againKey = newKey();
    const again = await authed(
      http().post(`/api/trips/${tripId}/start`),
      hinataCookie,
    )
      .set("Idempotency-Key", againKey)
      .set("If-Match", '"2"');
    expect(again.status).toBe(200);
    expect(again.body.version).toBe("2");
    expect(again.body.startedAt).toBe(before.body.startedAt);

    // 同じキーの再送も同じ結果
    const replay = await authed(
      http().post(`/api/trips/${tripId}/start`),
      hinataCookie,
    )
      .set("Idempotency-Key", againKey)
      .set("If-Match", '"2"');
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(again.body);

    const after = await authed(http().get(`/api/trips/${tripId}`), hinataCookie);
    expect(after.body.version).toBe("2");
    expect(after.body.startedAt).toBe(before.body.startedAt);
  });

  it("T-16: finished でも名前・期間の変更は成功する（予定操作は M2-b）", async () => {
    const tripId = await createTrip(hinataCookie);
    await authed(http().post(`/api/trips/${tripId}/start`), hinataCookie)
      .set("Idempotency-Key", newKey())
      .set("If-Match", '"1"');
    await authed(http().post(`/api/trips/${tripId}/finish`), hinataCookie)
      .set("Idempotency-Key", newKey())
      .set("If-Match", '"2"');

    const renamed = await authed(
      http().patch(`/api/trips/${tripId}`),
      hinataCookie,
    )
      .set("Idempotency-Key", newKey())
      .set("If-Match", '"3"')
      .send({ name: "行ってきた旅行" });
    expect(renamed.status).toBe(200);
    expect(renamed.body).toMatchObject({ name: "行ってきた旅行", status: "finished", version: "4" });

    const period = await authed(
      http().put(`/api/trips/${tripId}/period`),
      hinataCookie,
    )
      .set("Idempotency-Key", newKey())
      .set("If-Match", '"4"')
      .send({ startsOn: "2026-09-09", endsOn: "2026-09-13" });
    expect(period.status).toBe(200);
    expect(period.body).toMatchObject({ startsOn: "2026-09-09", endsOn: "2026-09-13", version: "5" });
  });
});

describe("形式・値の違反と Guard（T-17〜T-18）", () => {
  it("T-17: 未知の項目・名前 101 文字・開始 > 終了・実在しない日付・キーなし", async () => {
    const unknownField = await postTrip(hinataCookie, {
      ...TRIP_BODY,
      extra: "x",
    });
    expect(unknownField.status).toBe(400);
    expect(unknownField.body).toMatchObject({ code: "INVALID_REQUEST" });

    const longName = await postTrip(hinataCookie, {
      ...TRIP_BODY,
      name: "あ".repeat(101),
    });
    expect(longName.status).toBe(422);
    expect(longName.body).toMatchObject({ code: "VALIDATION_FAILED" });

    const reversed = await postTrip(hinataCookie, {
      ...TRIP_BODY,
      startsOn: "2026-09-12",
      endsOn: "2026-09-10",
    });
    expect(reversed.status).toBe(422);
    expect(reversed.body).toMatchObject({ code: "VALIDATION_FAILED" });

    const unreal = await postTrip(hinataCookie, {
      ...TRIP_BODY,
      startsOn: "2026-02-30",
      endsOn: "2026-03-05",
    });
    expect(unreal.status).toBe(422);
    expect(unreal.body).toMatchObject({ code: "VALIDATION_FAILED" });

    const noKey = await authed(http().post("/api/trips"), hinataCookie).send(TRIP_BODY);
    expect(noKey.status).toBe(400);
    expect(noKey.body).toMatchObject({ code: "INVALID_REQUEST" });
  });

  it("T-18: 別 Origin は 403、text/plain は 415、エラーは共通の形", async () => {
    const badOrigin = await http()
      .post("/api/trips")
      .set("Cookie", hinataCookie)
      .set("Origin", EVIL_ORIGIN)
      .set("Content-Type", "application/json")
      .set("Idempotency-Key", newKey())
      .send(TRIP_BODY);
    expect(badOrigin.status).toBe(403);
    expect(badOrigin.body).toMatchObject({
      code: "FORBIDDEN_ORIGIN",
      message: expect.any(String),
      requestId: expect.any(String),
      retryable: false,
    });

    const plain = await http()
      .post("/api/trips")
      .set("Cookie", hinataCookie)
      .set("Origin", ORIGIN)
      .set("Content-Type", "text/plain")
      .set("Idempotency-Key", newKey())
      .send("name=x");
    expect(plain.status).toBe(415);
    expect(plain.body).toMatchObject({
      code: "UNSUPPORTED_MEDIA_TYPE",
      message: expect.any(String),
      requestId: expect.any(String),
      retryable: false,
    });
  });
});
