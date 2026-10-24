import type { Plan } from "@tomotabi/contracts";

/**
 * 予定の書き込みUseCaseの結果。receiptに保存したものと同じ
 * httpStatus・bodyを持つ（body.versionが次のX-Expected-Versionの値）。
 */
export type PlanWriteResult = Readonly<{
  httpStatus: 200 | 201;
  body: Plan;
}>;
