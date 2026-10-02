import { openDB, type DBSchema } from "idb";
import type { MutationRequest } from "@/shared/api/mutation-request";

/**
 * 結果不明の要求を IndexedDB に残す（ADR-0006、詳細設計「保存状態と再送」）。
 * 送る直前に保存し、成功・確定した拒否で消す。結果不明・認証期限切れでは残す。
 * 保存するのは要求を送り直すのに要る組だけで、Cookie・セッショントークン・
 * Google の情報・未送信の入力は入れない。
 * サーバー描画で IndexedDB を触らないよう、呼び出しは effect 以降に限る。
 *
 * 読み出した値は書いたときのままとは限らない（端末上の保存は利用者が触れる）。
 * 形・経路・宛先を確かめてから使い、合わないものは送らずに消す。
 */

const DB_NAME = "tomotabi";
const DB_VERSION = 1;
const STORE_NAME = "pending-requests";

/** 保留を残す期間。createdAt からこれを超えたものは読むときに消して返さない。 */
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_SEGMENT =
  "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/**
 * 送り直せる経路の許可リスト。{tripId} 部はその保留の tripId と一致させる。
 * 支払い・精算の書き込み（createPayment・cancelPayment・createSettlementPreview・
 * completeSettlement・cancelSettlement）だけを許す。
 */
const ALLOWED_PATHS: readonly RegExp[] = [
  /^\/api\/trips\/[^/]+\/payments$/,
  new RegExp(`^/api/trips/[^/]+/payments/${UUID_SEGMENT}/cancel$`, "i"),
  /^\/api\/trips\/[^/]+\/settlement-previews$/,
  /^\/api\/trips\/[^/]+\/settlements$/,
  new RegExp(`^/api/trips/[^/]+/settlements/${UUID_SEGMENT}/cancel$`, "i"),
];

const ALLOWED_METHODS: ReadonlySet<string> = new Set(["POST", "PATCH", "PUT"]);

function isAllowedPendingUrl(record: {
  url?: unknown;
  tripId?: unknown;
}): boolean {
  if (
    typeof record.url !== "string" ||
    typeof record.tripId !== "string" ||
    record.tripId === "" ||
    !record.url.startsWith("/") ||
    record.url.startsWith("//")
  ) {
    return false;
  }
  let parsed: URL;
  try {
    parsed = new URL(record.url, window.location.origin);
  } catch {
    return false;
  }
  if (parsed.origin !== window.location.origin) {
    return false;
  }
  const prefix = `/api/trips/${record.tripId}/`;
  if (!record.url.startsWith(prefix) || !parsed.pathname.startsWith(prefix)) {
    return false;
  }
  return ALLOWED_PATHS.some((pattern) => pattern.test(parsed.pathname));
}

/**
 * 読み出した保留が送り直せる形か確かめる。経路は同一オリジンの
 * `/api/trips/{その保留の tripId}/` 配下で許可リストの経路だけ。
 * `idempotencyKey` は UUID、`bodyJson` は JSON として読める文字列だけ。
 */
export function isValidPendingRequest(record: {
  id?: unknown;
  userId?: unknown;
  tripId?: unknown;
  operation?: unknown;
  method?: unknown;
  url?: unknown;
  bodyJson?: unknown;
  idempotencyKey?: unknown;
  ifMatch?: unknown;
  createdAt?: unknown;
}): record is PendingRequestRecord {
  if (
    typeof record.idempotencyKey !== "string" ||
    !UUID_PATTERN.test(record.idempotencyKey) ||
    record.id !== record.idempotencyKey ||
    typeof record.userId !== "string" ||
    record.userId === "" ||
    typeof record.tripId !== "string" ||
    record.tripId === "" ||
    typeof record.operation !== "string" ||
    record.operation === "" ||
    typeof record.method !== "string" ||
    !ALLOWED_METHODS.has(record.method) ||
    (record.bodyJson !== null && typeof record.bodyJson !== "string") ||
    (record.ifMatch !== null && typeof record.ifMatch !== "string") ||
    typeof record.createdAt !== "string" ||
    Number.isNaN(Date.parse(record.createdAt))
  ) {
    return false;
  }
  if (record.bodyJson !== null) {
    try {
      JSON.parse(record.bodyJson);
    } catch {
      return false;
    }
  }
  return isAllowedPendingUrl(record);
}

function isExpired(record: PendingRequestRecord, now: number): boolean {
  return now - Date.parse(record.createdAt) > RETENTION_MS;
}

export type PendingRequestRecord = {
  /** 要求を一意に指す id（UUID）。再送に使う冪等キーと同じ値にする。 */
  id: string;
  userId: string;
  tripId: string;
  operation: string;
  method: MutationRequest["method"];
  url: string;
  bodyJson: string | null;
  idempotencyKey: string;
  ifMatch: string | null;
  /** ISO 8601。同じ操作に複数残ったときは新しいものを正とする。 */
  createdAt: string;
};

export type PendingRequestLookup =
  | { status: "none" }
  | { status: "found"; record: PendingRequestRecord }
  | {
      /** 保留はあったが形を確かめられず消した（「この保存は確かめられません」の扱い）。 */
      status: "invalid";
    };

interface PendingRequestsSchema extends DBSchema {
  "pending-requests": {
    key: string;
    value: PendingRequestRecord;
    indexes: {
      userId: string;
      tripId: string;
      operation: string;
      userTripOperation: [string, string, string];
    };
  };
}

async function withDb<T>(
  run: (db: Awaited<ReturnType<typeof openPendingDb>>) => Promise<T>,
): Promise<T> {
  const db = await openPendingDb();
  try {
    return await run(db);
  } finally {
    db.close();
  }
}

function openPendingDb() {
  return openDB<PendingRequestsSchema>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
      store.createIndex("userId", "userId");
      store.createIndex("tripId", "tripId");
      store.createIndex("operation", "operation");
      store.createIndex("userTripOperation", [
        "userId",
        "tripId",
        "operation",
      ]);
    },
  });
}

/** 送る直前に呼ぶ形（{ userId, tripId, request }）から保存レコードを作る。 */
export function toPendingRequestRecord(input: {
  userId: string;
  tripId: string;
  request: MutationRequest;
}): PendingRequestRecord {
  return {
    id: input.request.idempotencyKey,
    userId: input.userId,
    tripId: input.tripId,
    operation: input.request.operation,
    method: input.request.method,
    url: input.request.url,
    bodyJson: input.request.bodyJson,
    idempotencyKey: input.request.idempotencyKey,
    ifMatch: input.request.ifMatch,
    createdAt: new Date().toISOString(),
  };
}

/**
 * 送る直前に保存する。失敗したら例外を投げる（呼び出し側は送らずに止める）。
 * 同じ id の保留が既にある（同じキーでの確かめ直し）ときは、最初の createdAt を保つ。
 */
export async function savePendingRequest(
  record: PendingRequestRecord,
): Promise<void> {
  await withDb(async (db) => {
    const existing = await db.get(STORE_NAME, record.id);
    const createdAt =
      existing !== undefined &&
      !Number.isNaN(Date.parse(existing.createdAt))
        ? existing.createdAt
        : record.createdAt;
    await db.put(STORE_NAME, { ...record, createdAt });
  });
}

/**
 * 同じ利用者・旅行・操作の保留を探す。複数残っていたら
 * 新しいもの（createdAt の大きいもの）を返す。
 * 形・経路が確かめられないものと、保持期間（7 日）を超えたものは消す。
 * 確かめられないものだけがあったときは `invalid` を返す。
 */
export async function findPendingRequest(input: {
  userId: string;
  tripId: string;
  operation: string;
}): Promise<PendingRequestLookup> {
  return withDb(async (db) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const valid: PendingRequestRecord[] = [];
    const now = Date.now();
    let sawInvalid = false;
    let cursor = await tx.store
      .index("userTripOperation")
      .openCursor(IDBKeyRange.only([input.userId, input.tripId, input.operation]));
    while (cursor !== null) {
      const record = cursor.value;
      if (!isValidPendingRequest(record)) {
        await cursor.delete();
        sawInvalid = true;
      } else if (isExpired(record, now)) {
        await cursor.delete();
      } else {
        valid.push(record);
      }
      cursor = await cursor.continue();
    }
    await tx.done;
    if (valid.length === 0) {
      return sawInvalid ? { status: "invalid" } : { status: "none" };
    }
    return {
      status: "found",
      record: valid.reduce((a, b) => (a.createdAt >= b.createdAt ? a : b)),
    };
  });
}

/** 成功・確定した拒否のあとに消す。 */
export async function deletePendingRequest(id: string): Promise<void> {
  await withDb(async (db) => {
    await db.delete(STORE_NAME, id);
  });
}

/**
 * サインインした利用者以外の userId の保留をすべて消す。
 * 利用者が分かったときに呼ぶ（別の利用者の保留を残さない）。
 */
export async function deletePendingRequestsForOtherUsers(
  userId: string,
): Promise<void> {
  await withDb(async (db) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    let cursor = await tx.store.openCursor();
    while (cursor !== null) {
      if (cursor.value.userId !== userId) {
        await cursor.delete();
      }
      cursor = await cursor.continue();
    }
    await tx.done;
  });
}

/**
 * その利用者の保留をすべて返す（ログアウトの前の案内に使う）。
 * 確かめられない形のものと保持期間を超えたものは消して返さない。
 */
export async function listPendingRequestsForUser(
  userId: string,
): Promise<PendingRequestRecord[]> {
  return withDb(async (db) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const valid: PendingRequestRecord[] = [];
    const now = Date.now();
    let cursor = await tx.store.index("userId").openCursor(userId);
    while (cursor !== null) {
      const record = cursor.value;
      if (!isValidPendingRequest(record) || isExpired(record, now)) {
        await cursor.delete();
      } else {
        valid.push(record);
      }
      cursor = await cursor.continue();
    }
    await tx.done;
    return valid;
  });
}

/** ログアウトの成功時に、その利用者の保留をすべて消す。 */
export async function clearPendingRequestsForUser(
  userId: string,
): Promise<void> {
  await withDb(async (db) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    let cursor = await tx.store.index("userId").openCursor(userId);
    while (cursor !== null) {
      await cursor.delete();
      cursor = await cursor.continue();
    }
    await tx.done;
  });
}

/**
 * 保存されていた要求を送り直せる形に戻す（同じキー・本文・If-Match）。
 * 形・経路が確かめられないレコードには null を返す（呼び出し側は送らずに消す）。
 */
export function pendingRequestToMutation(
  record: PendingRequestRecord,
): MutationRequest | null {
  if (!isValidPendingRequest(record)) {
    return null;
  }
  return {
    operation: record.operation,
    url: record.url,
    method: record.method,
    bodyJson: record.bodyJson,
    ifMatch: record.ifMatch,
    idempotencyKey: record.idempotencyKey,
  };
}
