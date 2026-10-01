import { openDB, type DBSchema } from "idb";
import type { MutationRequest } from "@/shared/api/mutation-request";

/**
 * 結果不明の要求を IndexedDB に残す（ADR-0006、詳細設計「保存状態と再送」）。
 * 送る直前に保存し、成功・確定した拒否で消す。結果不明・認証期限切れでは残す。
 * 保存するのは要求を送り直すのに要る組だけで、Cookie・セッショントークン・
 * Google の情報・未送信の入力は入れない。
 * サーバー描画で IndexedDB を触らないよう、呼び出しは effect 以降に限る。
 */

const DB_NAME = "tomotabi";
const DB_VERSION = 1;
const STORE_NAME = "pending-requests";

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

/** 送る直前に保存する。失敗したら例外を投げる（呼び出し側は送らずに止める）。 */
export async function savePendingRequest(
  record: PendingRequestRecord,
): Promise<void> {
  await withDb(async (db) => {
    await db.put(STORE_NAME, record);
  });
}

/**
 * 同じ利用者・旅行・操作の保留を探す。複数残っていたら
 * 新しいもの（createdAt の大きいもの）を返す。なければ null。
 */
export async function findPendingRequest(input: {
  userId: string;
  tripId: string;
  operation: string;
}): Promise<PendingRequestRecord | null> {
  return withDb(async (db) => {
    const records = await db.getAllFromIndex(
      STORE_NAME,
      "userTripOperation",
      [input.userId, input.tripId, input.operation],
    );
    if (records.length === 0) {
      return null;
    }
    return records.reduce((a, b) => (a.createdAt >= b.createdAt ? a : b));
  });
}

/** 成功・確定した拒否のあとに消す。 */
export async function deletePendingRequest(id: string): Promise<void> {
  await withDb(async (db) => {
    await db.delete(STORE_NAME, id);
  });
}

/** その利用者の保留をすべて返す（ログアウトの前の案内に使う）。 */
export async function listPendingRequestsForUser(
  userId: string,
): Promise<PendingRequestRecord[]> {
  return withDb(async (db) => db.getAllFromIndex(STORE_NAME, "userId", userId));
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

/** 保存されていた要求を送り直せる形に戻す（同じキー・本文・If-Match）。 */
export function pendingRequestToMutation(
  record: PendingRequestRecord,
): MutationRequest {
  return {
    operation: record.operation,
    url: record.url,
    method: record.method,
    bodyJson: record.bodyJson,
    ifMatch: record.ifMatch,
    idempotencyKey: record.idempotencyKey,
  };
}
