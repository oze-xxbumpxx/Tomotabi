import type { Plan } from "@tomotabi/contracts";

/**
 * 予定の書き込み UseCase の結果。receipt に保存したものと同じ
 * httpStatus・body を持つ（body.version が ETag の中身）。
 */
export type PlanWriteResult = Readonly<{
  httpStatus: 200 | 201;
  body: Plan;
}>;
