import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import type { Auth } from "better-auth";
import type { TestHelpers } from "better-auth/plugins";
import { testUtils } from "better-auth/plugins";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { closePool, getPool } from "../../src/infrastructure/database/pool";
import { createAuth } from "../../src/modules/identity/infrastructure/better-auth";
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

const TRIP_BODY = {
  name: "京都 2 泊",
  startsOn: "2026-09-10",
  endsOn: "2026-09-12",
};

async function createTrip(
  cookie: string,
  overrides: Partial<typeof TRIP_BODY> = {},
): Promise<string> {
  const response = await authed(http().post("/api/trips"), cookie)
    .set("Idempotency-Key", newKey())
    .send({ ...TRIP_BODY, ...overrides });
  expect(response.status).toBe(201);
  return response.body.id as string;
}

async function postPlan(
  cookie: string,
  tripId: string,
  body: unknown,
  key = newKey(),
): Promise<request.Response> {
  return authed(http().post(`/api/trips/${tripId}/plans`), cookie)
    .set("Idempotency-Key", key)
    .send(body);
}

async function createPlan(
  cookie: string,
  tripId: string,
  body: Record<string, unknown>,
  key = newKey(),
): Promise<{ id: string; version: string }> {
  const response = await postPlan(cookie, tripId, body, key);
  expect(response.status).toBe(201);
  return {
    id: response.body.id as string,
    version: `${response.body.version as string}`,
  };
}

/** ひなたが参加しない旅行を別利用者2人で直接作る。 */
async function seedForeignTrip(): Promise<string> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const u0 = await insertUser(
    `foreign-${suffix}-0`,
    `foreign-${suffix}-0@example.test`,
  );
  const u1 = await insertUser(
    `foreign-${suffix}-1`,
    `foreign-${suffix}-1@example.test`,
  );
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

async function postTodo(
  cookie: string,
  tripId: string,
  name: string,
  key = newKey(),
): Promise<request.Response> {
  return authed(http().post(`/api/trips/${tripId}/todos`), cookie)
    .set("Idempotency-Key", key)
    .send({ name });
}

async function todoAction(
  cookie: string,
  tripId: string,
  todoId: string,
  action: "complete" | "reopen" | "delete",
  key = newKey(),
): Promise<request.Response> {
  return authed(
    http().post(`/api/trips/${tripId}/todos/${todoId}/${action}`),
    cookie,
  ).set("Idempotency-Key", key);
}

async function listTodos(cookie: string, tripId: string) {
  return authed(http().get(`/api/trips/${tripId}/todos`), cookie);
}

describe("ToDoのAPI（trip-todo）", () => {
  it("追加は201、一覧は追加した順で、相手にも見える", async () => {
    const tripId = await createTrip(hinataCookie);
    const a = await postTodo(hinataCookie, tripId, "清水寺");
    const b = await postTodo(aoiCookie, tripId, "両替する");
    const c = await postTodo(hinataCookie, tripId, "湯豆腐");
    expect(a.status).toBe(201);
    expect(a.headers["cache-control"]).toBe("private, no-store");
    await todoAction(aoiCookie, tripId, a.body.id as string, "complete");

    const list = await listTodos(aoiCookie, tripId);
    expect(list.status).toBe(200);
    expect(list.headers["cache-control"]).toBe("private, no-store");
    // 一覧は追加した順（完了かどうかで並べ替えない）。
    expect(
      (list.body.items as { name: string }[]).map((item) => item.name),
    ).toEqual(["清水寺", "両替する", "湯豆腐"]);
    expect(list.body.items[0]).toMatchObject({
      createdBy: hinata.userId,
      doneBy: aoi.userId,
    });
    expect(b.body.createdBy).toBe(aoi.userId);
    expect(c.status).toBe(201);
  });

  it("編集は版が要り、古い版は409、無ければ428", async () => {
    const tripId = await createTrip(hinataCookie);
    const todo = await postTodo(hinataCookie, tripId, "清水寺");
    const todoId = todo.body.id as string;
    const patch = (version: string | null, body: unknown) => {
      const req = authed(
        http().patch(`/api/trips/${tripId}/todos/${todoId}`),
        hinataCookie,
      ).set("Idempotency-Key", newKey());
      return (
        version === null ? req : req.set("X-Expected-Version", version)
      ).send(body);
    };
    const ok = await patch("1", { memo: "夜間拝観" });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ memo: "夜間拝観", version: "2" });
    expect((await patch("1", { name: "清水寺の夜" })).body.code).toBe(
      "VERSION_CONFLICT",
    );
    expect((await patch(null, { name: "清水寺の夜" })).status).toBe(428);
  });

  it("削除は200 `{ id }`、同じキーの再送も200、別のキーは404", async () => {
    const tripId = await createTrip(hinataCookie);
    const todo = await postTodo(hinataCookie, tripId, "清水寺");
    const todoId = todo.body.id as string;
    const key = newKey();
    const first = await todoAction(hinataCookie, tripId, todoId, "delete", key);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ id: todoId });
    const replay = await todoAction(
      hinataCookie,
      tripId,
      todoId,
      "delete",
      key,
    );
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual({ id: todoId });
    const other = await todoAction(aoiCookie, tripId, todoId, "delete");
    expect(other.status).toBe(404);
    expect(other.body.code).toBe("TODO_NOT_FOUND");
  });

  it("参加していない旅行は一覧も追加も403", async () => {
    const tripId = await seedForeignTrip();
    expect((await listTodos(hinataCookie, tripId)).status).toBe(403);
    const created = await postTodo(hinataCookie, tripId, "清水寺");
    expect(created.status).toBe(403);
    expect(created.body.code).toBe("TRIP_NOT_ACCESSIBLE");
  });

  it("参加していない人は、ToDoの編集・完了・戻す・削除も403で、行は変わらない", async () => {
    const tripId = await seedForeignTrip();
    const owner = await db.admin.query<{ user_id: string }>(
      "SELECT user_id FROM planning.trip_participants WHERE trip_id = $1 AND slot = 0",
      [tripId],
    );
    const inserted = await db.admin.query<{ id: string }>(
      "INSERT INTO planning.todos (trip_id, name, created_by) VALUES ($1, '清水寺', $2) RETURNING id",
      [tripId, owner.rows[0]!.user_id],
    );
    const todoId = inserted.rows[0]!.id;
    const patched = await authed(
      http().patch(`/api/trips/${tripId}/todos/${todoId}`),
      hinataCookie,
    )
      .set("Idempotency-Key", newKey())
      .set("X-Expected-Version", "1")
      .send({ name: "書き換え" });
    expect(patched.status).toBe(403);
    expect(patched.body.code).toBe("TRIP_NOT_ACCESSIBLE");
    for (const action of ["complete", "reopen", "delete"] as const) {
      const response = await todoAction(hinataCookie, tripId, todoId, action);
      expect(response.status).toBe(403);
      expect(response.body.code).toBe("TRIP_NOT_ACCESSIBLE");
    }
    const row = await db.admin.query(
      "SELECT name, done_at, version FROM planning.todos WHERE id = $1",
      [todoId],
    );
    expect(row.rows[0]).toMatchObject({ name: "清水寺", done_at: null });
  });

  it("予定にすると、予定と完了が一度に決まり、一覧に予定の日付が出る", async () => {
    const tripId = await createTrip(hinataCookie);
    const todo = await postTodo(hinataCookie, tripId, "湯豆腐");
    const todoId = todo.body.id as string;
    const key = newKey();
    const body = {
      name: "湯豆腐",
      kind: "food",
      date: "2026-09-11",
      fromTodoId: todoId,
    };
    const plan = await postPlan(aoiCookie, tripId, body, key);
    expect(plan.status).toBe(201);
    const replay = await postPlan(aoiCookie, tripId, body, key);
    expect(replay.body.id).toBe(plan.body.id);

    const list = await listTodos(hinataCookie, tripId);
    expect(list.body.items[0]).toMatchObject({
      id: todoId,
      doneBy: aoi.userId,
      plan: { id: plan.body.id, date: "2026-09-11", cancelled: false },
    });
    const plans = await db.admin.query(
      "SELECT count(*)::int AS c FROM planning.plans WHERE trip_id = $1",
      [tripId],
    );
    expect(plans.rows[0].c).toBe(1);

    const reopened = await todoAction(hinataCookie, tripId, todoId, "reopen");
    expect(reopened.body).toMatchObject({
      doneAt: null,
      plan: {
        id: plan.body.id,
        name: "湯豆腐",
        date: "2026-09-11",
        cancelled: false,
      },
    });
  });

  it("予定の追加でToDoの更新が失敗したら、予定もできない", async () => {
    const tripId = await createTrip(hinataCookie);
    const todo = await postTodo(hinataCookie, tripId, "湯豆腐");
    const todoId = todo.body.id as string;
    // ToDoの更新だけを失敗させる（作り込んだ失敗。終わったら外す）。
    await db.admin.query(`
      CREATE FUNCTION planning.fail_todo_update() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'forced failure'; END $$;
      CREATE TRIGGER fail_todo_update BEFORE UPDATE ON planning.todos
      FOR EACH ROW EXECUTE FUNCTION planning.fail_todo_update();
    `);
    try {
      const response = await postPlan(hinataCookie, tripId, {
        name: "湯豆腐",
        kind: "food",
        date: "2026-09-11",
        fromTodoId: todoId,
      });
      expect(response.status).toBe(500);
    } finally {
      await db.admin.query(`
        DROP TRIGGER fail_todo_update ON planning.todos;
        DROP FUNCTION planning.fail_todo_update();
      `);
    }
    const plans = await db.admin.query(
      "SELECT count(*)::int AS c FROM planning.plans WHERE trip_id = $1",
      [tripId],
    );
    expect(plans.rows[0].c).toBe(0);
  });

  it("表の決まり: 完了の対・別の旅行の予定は指せない（未完了でも予定と結べる）", async () => {
    const tripId = await createTrip(hinataCookie);
    const ownPlan = await createPlan(hinataCookie, tripId, {
      name: "清水寺",
      kind: "place",
      date: "2026-09-11",
    });
    const otherTrip = await createTrip(hinataCookie);
    const otherPlan = await createPlan(hinataCookie, otherTrip, {
      name: "金閣寺",
      kind: "place",
      date: "2026-09-11",
    });
    const insert = (columns: string, values: string, params: unknown[]) =>
      db.admin.query(
        `INSERT INTO planning.todos (trip_id, name, created_by${columns}) VALUES ($1, 'x', $2${values})`,
        [tripId, hinata.userId, ...params],
      );
    await expect(insert(", done_at", ", now()", [])).rejects.toThrow();
    // F-18の変更で、未完了でも予定と結べる（todo_plan_requires_doneを外した）。
    const linked = await insert(", plan_id", ", $3", [ownPlan.id]);
    expect(linked.rowCount).toBe(1);
    await expect(
      insert(", plan_id", ", $3", [otherPlan.id]),
    ).rejects.toThrow();
    await expect(
      insert(", done_at, done_by, plan_id", ", now(), $2, $3", [otherPlan.id]),
    ).rejects.toThrow();
  });
});
