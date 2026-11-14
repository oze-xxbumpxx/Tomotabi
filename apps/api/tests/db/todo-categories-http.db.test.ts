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

async function createTrip(cookie: string): Promise<string> {
  const response = await authed(http().post("/api/trips"), cookie)
    .set("Idempotency-Key", newKey())
    .send(TRIP_BODY);
  expect(response.status).toBe(201);
  return response.body.id as string;
}

async function postCategory(
  cookie: string,
  tripId: string,
  name: string,
  key = newKey(),
): Promise<request.Response> {
  return authed(http().post(`/api/trips/${tripId}/todo-categories`), cookie)
    .set("Idempotency-Key", key)
    .send({ name });
}

async function createCategory(
  cookie: string,
  tripId: string,
  name: string,
  key = newKey(),
): Promise<{ id: string; version: string }> {
  const response = await postCategory(cookie, tripId, name, key);
  expect(response.status).toBe(201);
  return { id: response.body.id as string, version: `${response.body.version}` };
}

function patchCategory(
  cookie: string,
  tripId: string,
  categoryId: string,
  version: string | null,
  name: string,
): Promise<request.Response> {
  const req = authed(
    http().patch(`/api/trips/${tripId}/todo-categories/${categoryId}`),
    cookie,
  ).set("Idempotency-Key", newKey());
  return (version === null ? req : req.set("X-Expected-Version", version)).send(
    { name },
  );
}

function reorder(
  cookie: string,
  tripId: string,
  from: string[],
  to: string[],
  key = newKey(),
): Promise<request.Response> {
  return authed(http().put(`/api/trips/${tripId}/todo-categories/order`), cookie)
    .set("Idempotency-Key", key)
    .send({ from, to });
}

function deleteCategory(
  cookie: string,
  tripId: string,
  categoryId: string,
  expectedTodoCount: number,
  key = newKey(),
): Promise<request.Response> {
  return authed(
    http().post(`/api/trips/${tripId}/todo-categories/${categoryId}/delete`),
    cookie,
  )
    .set("Idempotency-Key", key)
    .send({ expectedTodoCount });
}

async function postTodo(
  cookie: string,
  tripId: string,
  name: string,
  categoryId?: string | null,
  key = newKey(),
): Promise<request.Response> {
  return authed(http().post(`/api/trips/${tripId}/todos`), cookie)
    .set("Idempotency-Key", key)
    .send({ name, categoryId });
}

function patchTodo(
  cookie: string,
  tripId: string,
  todoId: string,
  version: string,
  body: unknown,
): Promise<request.Response> {
  return authed(http().patch(`/api/trips/${tripId}/todos/${todoId}`), cookie)
    .set("Idempotency-Key", newKey())
    .set("X-Expected-Version", version)
    .send(body);
}

function todoAction(
  cookie: string,
  tripId: string,
  todoId: string,
  action: "complete" | "reopen",
): Promise<request.Response> {
  return authed(
    http().post(`/api/trips/${tripId}/todos/${todoId}/${action}`),
    cookie,
  ).set("Idempotency-Key", newKey());
}

async function listTodos(cookie: string, tripId: string) {
  return authed(http().get(`/api/trips/${tripId}/todos`), cookie);
}

/** ひなた・あおいが参加しない旅行を別利用者2人で直接作る。 */
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

describe("カテゴリのAPI（todo-organize A-I）", () => {
  it("一覧にカテゴリとToDoの3つの欄が入る（A-I01）", async () => {
    const tripId = await createTrip(hinataCookie);
    const food = await createCategory(hinataCookie, tripId, "食べるもの");
    const prep = await createCategory(aoiCookie, tripId, "用意するもの");
    await postTodo(hinataCookie, tripId, "湯豆腐", food.id);
    await postTodo(aoiCookie, tripId, "保険", prep.id);
    await postTodo(hinataCookie, tripId, "清水寺");

    const patched = await patchTodo(
      aoiCookie,
      tripId,
      (await listTodos(aoiCookie, tripId)).body.items[0].id as string,
      "1",
      { assigneeId: aoi.userId, dueOn: "2026-09-11" },
    );
    expect(patched.status).toBe(200);

    const list = await listTodos(hinataCookie, tripId);
    expect(
      (list.body.categories as { name: string }[]).map((c) => c.name),
    ).toEqual(["食べるもの", "用意するもの"]);
    const items = list.body.items as {
      name: string;
      categoryId: string | null;
      assigneeId: string | null;
      dueOn: string | null;
    }[];
    expect(items.map((item) => item.name)).toEqual([
      "湯豆腐",
      "保険",
      "清水寺",
    ]);
    expect(items[0]).toMatchObject({
      categoryId: food.id,
      assigneeId: aoi.userId,
      dueOn: "2026-09-11",
    });
    expect(items[2].categoryId).toBeNull();
  });

  it("migrationの前に作ったToDoは未分類・未定・期限なし（A-I02）", async () => {
    const tripId = await createTrip(hinataCookie);
    const inserted = await db.admin.query<{ id: string }>(
      "INSERT INTO planning.todos (trip_id, name, created_by) VALUES ($1, '古いToDo', $2) RETURNING id",
      [tripId, hinata.userId],
    );
    const list = await listTodos(hinataCookie, tripId);
    expect(list.body.items[0]).toMatchObject({
      id: inserted.rows[0]!.id,
      categoryId: null,
      assigneeId: null,
      dueOn: null,
    });
  });

  it("追加は同じキーの再送で同じ応答・行は1件（A-I03）", async () => {
    const tripId = await createTrip(hinataCookie);
    const key = newKey();
    const first = await postCategory(hinataCookie, tripId, "持ちもの", key);
    const second = await postCategory(hinataCookie, tripId, "持ちもの", key);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    const list = await listTodos(hinataCookie, tripId);
    expect(list.body.categories).toHaveLength(1);
  });

  it("古い版の名前変更は409 VERSION_CONFLICT（A-I04）", async () => {
    const tripId = await createTrip(hinataCookie);
    const cat = await createCategory(hinataCookie, tripId, "持ちもの");
    expect(
      (await patchCategory(aoiCookie, tripId, cat.id, "1", "先に変えた")).status,
    ).toBe(200);
    const stale = await patchCategory(hinataCookie, tripId, cat.id, "1", "遅れた変更");
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe("VERSION_CONFLICT");
  });

  it("並べ替えは一覧の順を変える（A-I05）", async () => {
    const tripId = await createTrip(hinataCookie);
    const a = await createCategory(hinataCookie, tripId, "A");
    const b = await createCategory(hinataCookie, tripId, "B");
    const c = await createCategory(hinataCookie, tripId, "C");
    const result = await reorder(
      aoiCookie,
      tripId,
      [a.id, b.id, c.id],
      [c.id, a.id, b.id],
    );
    expect(result.status).toBe(200);
    expect(
      (result.body.categories as { id: string }[]).map((cat) => cat.id),
    ).toEqual([c.id, a.id, b.id]);
    const list = await listTodos(hinataCookie, tripId);
    expect(
      (list.body.categories as { id: string }[]).map((cat) => cat.id),
    ).toEqual([c.id, a.id, b.id]);
  });

  it("fromが今の順と違う並べ替えは409で順は変わらない（A-I06）", async () => {
    const tripId = await createTrip(hinataCookie);
    const a = await createCategory(hinataCookie, tripId, "A");
    const b = await createCategory(hinataCookie, tripId, "B");
    const c = await createCategory(aoiCookie, tripId, "D");
    const result = await reorder(
      hinataCookie,
      tripId,
      [a.id, b.id],
      [b.id, a.id],
    );
    expect(result.status).toBe(409);
    expect(result.body.code).toBe("TODO_CATEGORY_ORDER_CHANGED");
    const list = await listTodos(hinataCookie, tripId);
    expect(
      (list.body.categories as { id: string }[]).map((cat) => cat.id),
    ).toEqual([a.id, b.id, c.id]);
  });

  it("同じfromの同時の並べ替えは片方だけ通る（A-I07）", async () => {
    const tripId = await createTrip(hinataCookie);
    const a = await createCategory(hinataCookie, tripId, "A");
    const b = await createCategory(hinataCookie, tripId, "B");
    const c = await createCategory(hinataCookie, tripId, "C");
    const from = [a.id, b.id, c.id];
    const [first, second] = await Promise.all([
      reorder(hinataCookie, tripId, from, [b.id, a.id, c.id]),
      reorder(aoiCookie, tripId, from, [c.id, a.id, b.id]),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    const list = await listTodos(hinataCookie, tripId);
    expect(list.body.categories).toHaveLength(3);
  });

  it("同時の追加で上限を超えない（A-I08）", async () => {
    const tripId = await createTrip(hinataCookie);
    for (let i = 0; i < 19; i += 1) {
      await createCategory(hinataCookie, tripId, `c${i}`);
    }
    const [first, second] = await Promise.all([
      postCategory(hinataCookie, tripId, "20個目"),
      postCategory(aoiCookie, tripId, "21個目"),
    ]);
    expect([first.status, second.status].sort()).toEqual([201, 422]);
    const list = await listTodos(hinataCookie, tripId);
    expect(list.body.categories).toHaveLength(20);
  });

  it("カテゴリの削除は中のToDoも消し、deletedTodoCountを返す（A-I09）", async () => {
    const tripId = await createTrip(hinataCookie);
    const x = await createCategory(hinataCookie, tripId, "X");
    const y = await createCategory(hinataCookie, tripId, "Y");
    for (const name of ["x1", "x2", "x3"]) {
      await postTodo(hinataCookie, tripId, name, x.id);
    }
    await postTodo(hinataCookie, tripId, "y1", y.id);
    await postTodo(hinataCookie, tripId, "未分類");
    const deleted = await deleteCategory(hinataCookie, tripId, x.id, 3);
    expect(deleted.status).toBe(200);
    expect(deleted.body).toEqual({ id: x.id, deletedTodoCount: 3 });
    const list = await listTodos(hinataCookie, tripId);
    expect(
      (list.body.items as { name: string }[]).map((item) => item.name),
    ).toEqual(["y1", "未分類"]);
    expect(list.body.categories).toHaveLength(1);
  });

  it("件数が違う削除は409で何も消えない（A-I10）", async () => {
    const tripId = await createTrip(hinataCookie);
    const cat = await createCategory(hinataCookie, tripId, "X");
    await postTodo(hinataCookie, tripId, "x1", cat.id);
    const result = await deleteCategory(hinataCookie, tripId, cat.id, 0);
    expect(result.status).toBe(409);
    expect(result.body.code).toBe("TODO_COUNT_CHANGED");
    const list = await listTodos(hinataCookie, tripId);
    expect(list.body.categories).toHaveLength(1);
    expect(list.body.items).toHaveLength(1);
  });

  it("空のカテゴリはexpectedTodoCount 0で消える（A-I11）", async () => {
    const tripId = await createTrip(hinataCookie);
    const cat = await createCategory(hinataCookie, tripId, "空");
    const deleted = await deleteCategory(hinataCookie, tripId, cat.id, 0);
    expect(deleted.status).toBe(200);
    expect(deleted.body).toEqual({ id: cat.id, deletedTodoCount: 0 });
  });

  it("削除の再送は行が無くても同じ応答（A-I12）", async () => {
    const tripId = await createTrip(hinataCookie);
    const cat = await createCategory(hinataCookie, tripId, "X");
    const key = newKey();
    const first = await deleteCategory(hinataCookie, tripId, cat.id, 0, key);
    const second = await deleteCategory(hinataCookie, tripId, cat.id, 0, key);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
  });

  it("消えたカテゴリへの操作は404/422（A-I13）", async () => {
    const tripId = await createTrip(hinataCookie);
    const cat = await createCategory(hinataCookie, tripId, "X");
    await deleteCategory(aoiCookie, tripId, cat.id, 0);
    const renamed = await patchCategory(hinataCookie, tripId, cat.id, "1", "新名");
    expect(renamed.status).toBe(404);
    expect(renamed.body.code).toBe("TODO_CATEGORY_NOT_FOUND");
    const again = await deleteCategory(hinataCookie, tripId, cat.id, 0);
    expect(again.status).toBe(404);
    const todo = await postTodo(hinataCookie, tripId, "x1", cat.id);
    expect(todo.status).toBe(422);
    expect(todo.body.code).toBe("TODO_CATEGORY_NOT_FOUND");
  });

  it("別の旅行のカテゴリはToDoに入れられず名前も変えられない（A-I14）", async () => {
    const tripId = await createTrip(hinataCookie);
    const foreignTripId = await seedForeignTrip();
    const foreign = await db.admin.query<{ id: string }>(
      `INSERT INTO planning.todo_categories (trip_id, name, position, created_by)
       VALUES ($1, '外国のカテゴリ', 0, (SELECT user_id FROM planning.trip_participants WHERE trip_id = $1 AND slot = 0)) RETURNING id`,
      [foreignTripId],
    );
    const foreignId = foreign.rows[0]!.id;
    const todo = await postTodo(hinataCookie, tripId, "x1", foreignId);
    expect(todo.status).toBe(422);
    const renamed = await patchCategory(hinataCookie, tripId, foreignId, "1", "侵入");
    expect(renamed.status).toBe(404);
  });

  it("参加者でない人は4つの操作と一覧が403（A-I15）", async () => {
    const tripId = await seedForeignTrip();
    const foreign = await db.admin.query<{ id: string }>(
      `INSERT INTO planning.todo_categories (trip_id, name, position, created_by)
       VALUES ($1, 'x', 0, (SELECT user_id FROM planning.trip_participants WHERE trip_id = $1 AND slot = 0)) RETURNING id`,
      [tripId],
    );
    const categoryId = foreign.rows[0]!.id;
    expect((await listTodos(hinataCookie, tripId)).status).toBe(403);
    expect(
      (await postCategory(hinataCookie, tripId, "侵入")).status,
    ).toBe(403);
    expect(
      (await patchCategory(hinataCookie, tripId, categoryId, "1", "侵入")).status,
    ).toBe(403);
    expect(
      (await reorder(hinataCookie, tripId, [categoryId], [categoryId])).status,
    ).toBe(403);
    expect(
      (await deleteCategory(hinataCookie, tripId, categoryId, 0)).status,
    ).toBe(403);
  });

  it("未完了に戻しても予定とのつながりは残る（A-I16・A-I17）", async () => {
    const tripId = await createTrip(hinataCookie);
    const todo = await postTodo(hinataCookie, tripId, "湯豆腐");
    const todoId = todo.body.id as string;
    const plan = await authed(http().post(`/api/trips/${tripId}/plans`), hinataCookie)
      .set("Idempotency-Key", newKey())
      .send({
        name: "湯豆腐",
        kind: "food",
        date: "2026-09-11",
        fromTodoId: todoId,
      });
    expect(plan.status).toBe(201);

    const reopened = await todoAction(aoiCookie, tripId, todoId, "reopen");
    expect(reopened.status).toBe(200);
    expect(reopened.body).toMatchObject({
      doneAt: null,
      plan: { id: plan.body.id, name: "湯豆腐" },
    });
    const completed = await todoAction(hinataCookie, tripId, todoId, "complete");
    expect(completed.status).toBe(200);
    expect(completed.body.plan.id).toBe(plan.body.id);
    const list = await listTodos(aoiCookie, tripId);
    expect(list.body.items[0].plan.id).toBe(plan.body.id);
  });

  it("読み取りのあいだにカテゴリを足しても一覧は破れない（A-I18）", async () => {
    const tripId = await createTrip(hinataCookie);
    const cat = await createCategory(hinataCookie, tripId, "X");
    await postTodo(hinataCookie, tripId, "x1", cat.id);
    const [list] = await Promise.all([
      listTodos(hinataCookie, tripId),
      postCategory(aoiCookie, tripId, "Y"),
    ]);
    const categoryIds = new Set(
      (list.body.categories as { id: string }[]).map((c) => c.id),
    );
    for (const item of list.body.items as { categoryId: string | null }[]) {
      if (item.categoryId !== null) {
        expect(categoryIds.has(item.categoryId)).toBe(true);
      }
    }
  });

  it("担当は自分・相手・nullのどれでも通る（A-I19）", async () => {
    const tripId = await createTrip(hinataCookie);
    const todo = await postTodo(hinataCookie, tripId, "x1");
    const todoId = todo.body.id as string;
    const self = await patchTodo(hinataCookie, tripId, todoId, "1", {
      assigneeId: hinata.userId,
    });
    expect(self.body.assigneeId).toBe(hinata.userId);
    const partner = await patchTodo(hinataCookie, tripId, todoId, "2", {
      assigneeId: aoi.userId,
    });
    expect(partner.body.assigneeId).toBe(aoi.userId);
    const cleared = await patchTodo(hinataCookie, tripId, todoId, "3", {
      assigneeId: null,
    });
    expect(cleared.body.assigneeId).toBeNull();
  });

  it("旅行が終わったあともカテゴリ・担当・期限を変えられる（A-I20）", async () => {
    const tripId = await createTrip(hinataCookie);
    await db.admin.query(
      `UPDATE planning.trips SET status = 'finished',
         started_at = now(), started_by = $2,
         finished_at = now(), finished_by = $2, version = 2 WHERE id = $1`,
      [tripId, hinata.userId],
    );
    const cat = await createCategory(hinataCookie, tripId, "思い出");
    const todo = await postTodo(hinataCookie, tripId, "x1", cat.id);
    const patched = await patchTodo(hinataCookie, tripId, todo.body.id as string, "1", {
      assigneeId: aoi.userId,
      dueOn: "2026-09-11",
    });
    expect(patched.status).toBe(200);
  });

  it("受領の種類がtodo_category系で保存できる（A-I21）", async () => {
    const tripId = await createTrip(hinataCookie);
    const cat = await createCategory(hinataCookie, tripId, "X");
    await reorder(hinataCookie, tripId, [cat.id], [cat.id]);
    await deleteCategory(hinataCookie, tripId, cat.id, 0);
    const receipts = await db.admin.query<{ resource_type: string }>(
      `SELECT DISTINCT resource_type FROM infra.command_receipts
        WHERE trip_id = $1 AND resource_type LIKE 'todo_category%'`,
      [tripId],
    );
    expect(receipts.rows.map((row) => row.resource_type).sort()).toEqual([
      "todo_category",
      "todo_category_deletion",
      "todo_category_order",
    ]);
  });

  it("表の決まり: カテゴリの名前と位置・別の旅行の組み合わせ", async () => {
    const tripId = await createTrip(hinataCookie);
    const otherTrip = await createTrip(hinataCookie);
    const insert = (columns: string, values: string, params: unknown[]) =>
      db.admin.query(
        `INSERT INTO planning.todo_categories (trip_id, name, position, created_by${columns}) VALUES ($1, 'x', 0, $2${values})`,
        [tripId, hinata.userId, ...params],
      );
    await expect(insert("", "" , [])).resolves.toMatchObject({ rowCount: 1 });
    await expect(
      db.admin.query(
        "INSERT INTO planning.todo_categories (trip_id, name, position, created_by) VALUES ($1, '   ', 0, $2)",
        [tripId, hinata.userId],
      ),
    ).rejects.toThrow();
    await expect(
      db.admin.query(
        "INSERT INTO planning.todo_categories (trip_id, name, position, created_by) VALUES ($1, 'x', -1, $2)",
        [tripId, hinata.userId],
      ),
    ).rejects.toThrow();
    const outsider = await insertUser(
      `外の人-${crypto.randomUUID().slice(0, 8)}`,
      `soto-${crypto.randomUUID().slice(0, 8)}@example.test`,
    );
    await expect(
      db.admin.query(
        "INSERT INTO planning.todo_categories (trip_id, name, position, created_by) VALUES ($1, 'x', 0, $2)",
        [tripId, outsider],
      ),
    ).rejects.toThrow();
    const otherCat = await db.admin.query<{ id: string }>(
      "INSERT INTO planning.todo_categories (trip_id, name, position, created_by) VALUES ($1, 'x', 0, $2) RETURNING id",
      [otherTrip, hinata.userId],
    );
    await expect(
      db.admin.query(
        "INSERT INTO planning.todos (trip_id, name, created_by, category_id) VALUES ($1, 'x', $2, $3)",
        [tripId, hinata.userId, otherCat.rows[0]!.id],
      ),
    ).rejects.toThrow();
    await expect(
      db.admin.query(
        "INSERT INTO planning.todos (trip_id, name, created_by, assignee_id) VALUES ($1, 'x', $2, $3)",
        [tripId, hinata.userId, outsider],
      ),
    ).rejects.toThrow();
  });
});
