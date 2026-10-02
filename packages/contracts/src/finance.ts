import type { Cancellation } from "./plan";

/** 参加者 1 人分の負担。percent の合計は 100。 */
export type PaymentAllocation = {
  userId: string;
  /** 0〜100 の整数。 */
  percent: number;
  /** 円単位の非負整数（10 進の文字列）。サーバーが計算して確定する。 */
  burdenYen: string;
};

/** 支払い 1 件（取り消し状態を含む）。金額は 10 進の整数文字列。 */
export type Payment = {
  id: string;
  tripId: string;
  /** 関連する予定。結んでいないときは null。 */
  planId: string | null;
  /** 用途。無いときは null。 */
  label: string | null;
  /** 円単位の非負整数（10 進の文字列）。1〜9,999,999。 */
  amountYen: string;
  payerUserId: string;
  /** 参加者番号 0, 1 の順。二人分で percent の合計は 100。 */
  allocations: [PaymentAllocation, PaymentAllocation];
  createdBy: string;
  /** ISO 8601 の日時。 */
  createdAt: string;
  cancellation: Cancellation | null;
};
