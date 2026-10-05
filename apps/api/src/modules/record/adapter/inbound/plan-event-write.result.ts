import type { Cancellation, PlanEvent } from "@tomotabi/contracts";

/**
 * 達成・予約を付けるUseCaseの結果。receiptに保存したものと同じ
 * httpStatus・bodyを持つ（同じキーの再送は保存した201をそのまま返す）。
 */
export type PlanEventWriteResult = Readonly<{
  httpStatus: 200 | 201;
  body: PlanEvent;
}>;

/** 達成・予約の取り消しUseCaseの結果。既に取り消し済みなら200で既存の取り消し。 */
export type PlanEventCancellationResult = Readonly<{
  httpStatus: 200 | 201;
  body: Cancellation;
}>;
