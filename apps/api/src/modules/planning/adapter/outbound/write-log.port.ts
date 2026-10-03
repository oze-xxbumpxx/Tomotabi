export const WRITE_LOG = Symbol("WRITE_LOG");

/**
 * 業務の書き込み1件の記録（設計書「ログと監視」）。
 * 利用者の入力（旅行名・予定名・メモ）・Idempotency-Key・request_hashは含めない。
 * 結果コードの鍵名をerrorCodeにしているのは、pinoのredact "*.code"が
 * codeを[Redacted]にするため。
 */
export type WriteLogEntry = Readonly<{
  operation: string;
  tripId: string | null;
  resourceId: string | null;
  result: "created" | "replayed" | "rejected";
  errorCode: string | null;
  durationMs: number;
}>;

export interface WriteLog {
  info(entry: WriteLogEntry): void;
}
