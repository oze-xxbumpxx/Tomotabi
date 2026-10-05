import { createHash } from "node:crypto";
import type { IdempotencyKey } from "../http/idempotency-key";
import type { UserId } from "../domain/user-id";

/**
 * 書き込みの結果を記録するreceipt（infra.command_receipts行の値）。
 * (actorId, operation, idempotencyKey)が主キー。同じキーの成功再送は
 * responseBodyとhttpStatusをそのまま返す。requestHashが違う同一キーは
 * 409 IDEMPOTENCY_KEY_REUSED。
 */
export type CommandReceipt = Readonly<{
  actorId: UserId;
  operation: string;
  idempotencyKey: IdempotencyKey;
  tripId: string;
  /** 64桁の16進（computeRequestHashの結果） */
  requestHash: string;
  // infra.command_receiptsのCHECKが許す種類。財務（支払い・確認・精算）と
  // 記録（plan_event系）の種類はM3・M4の表に合わせて先に含めてある。
  resourceType:
    | "trip"
    | "plan"
    | "payment"
    | "payment_cancellation"
    | "preview"
    | "settlement"
    | "settlement_cancellation"
    | "plan_event"
    | "plan_event_cancellation";
  resourceId: string;
  httpStatus: 200 | 201;
  responseBody: unknown;
}>;

export type RequestHashInput = Readonly<{
  operation: string;
  /** 対象の旅行。作成時（まだ旅行が無い）はnull */
  tripId: string | null;
  /** 対象行のid。作成時はnull */
  resourceId: string | null;
  /** 検証後の正規化したbody。bodyの無い操作はnull */
  body: unknown;
  /** If-Matchのversion。不要な操作はnull */
  ifMatch: string | null;
}>;

/**
 * request_hashのための正規化JSON。オブジェクトのキー順を固定し、
 * 文字列は前後の空白を除く（BoundedTextが検証時に除く規則と揃える）。
 */
function normalize(value: unknown): unknown {
  if (typeof value === "string") {
    return value.trim();
  }
  if (Array.isArray(value)) {
    return value.map(normalize);
  }
  if (typeof value === "object" && value !== null) {
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      normalized[key] = normalize((value as Record<string, unknown>)[key]);
    }
    return normalized;
  }
  return value;
}

/**
 * `sha256(正規化 JSON { operation, tripId, resourceId, body, ifMatch })`を返す。
 * キーの順序や前後の空白だけが違う同一の操作は同じhashになる。
 */
export function computeRequestHash(input: RequestHashInput): string {
  const canonical = JSON.stringify(
    normalize({
      operation: input.operation,
      tripId: input.tripId,
      resourceId: input.resourceId,
      body: input.body,
      ifMatch: input.ifMatch,
    }),
  );
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
