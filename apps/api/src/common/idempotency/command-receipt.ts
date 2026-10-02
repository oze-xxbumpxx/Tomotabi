import { createHash } from "node:crypto";
import type { IdempotencyKey } from "../http/idempotency-key";
import type { UserId } from "../domain/user-id";

/**
 * 書き込みの結果を記録する receipt（infra.command_receipts 行の値）。
 * (actorId, operation, idempotencyKey) が主キー。同じキーの成功再送は
 * responseBody と httpStatus をそのまま返す。requestHash が違う同一キーは
 * 409 IDEMPOTENCY_KEY_REUSED。
 */
export type CommandReceipt = Readonly<{
  actorId: UserId;
  operation: string;
  idempotencyKey: IdempotencyKey;
  tripId: string;
  /** 64 桁の 16 進（computeRequestHash の結果） */
  requestHash: string;
  // infra.command_receipts の CHECK が許す種類。財務（支払い・確認・精算）の
  // 種類は M3 の表に合わせて先に含めてある（plan_event 系は M4 の記録 API で使う）。
  resourceType:
    | "trip"
    | "plan"
    | "payment"
    | "payment_cancellation"
    | "preview"
    | "settlement"
    | "settlement_cancellation";
  resourceId: string;
  httpStatus: 200 | 201;
  responseBody: unknown;
}>;

export type RequestHashInput = Readonly<{
  operation: string;
  /** 対象の旅行。作成時（まだ旅行が無い）は null */
  tripId: string | null;
  /** 対象行の id。作成時は null */
  resourceId: string | null;
  /** 検証後の正規化した body。body の無い操作は null */
  body: unknown;
  /** If-Match の version。不要な操作は null */
  ifMatch: string | null;
}>;

/**
 * request_hash のための正規化 JSON。オブジェクトのキー順を固定し、
 * 文字列は前後の空白を除く（BoundedText が検証時に除く規則と揃える）。
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
 * `sha256(正規化 JSON { operation, tripId, resourceId, body, ifMatch })` を返す。
 * キーの順序や前後の空白だけが違う同一の操作は同じ hash になる。
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
