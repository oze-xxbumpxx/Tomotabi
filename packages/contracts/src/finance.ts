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

/** 旅行の参加者 1 人（残額・確認の向き表示に使う）。 */
export type Participant = {
  userId: string;
  /** 参加者番号（0・1）。 */
  slot: 0 | 1;
  displayName: string;
};

/**
 * 受け渡しの向きと金額。0 円なら from/to は null で requiresTransfer は false。
 * 非 0 なら from と to は異なる旅行参加者（サーバーが整合性を保証する）。
 */
export type Transfer = {
  /** 参加者番号 1 の人から 0 の人への向きを正とする円単位整数（10 進の文字列）。 */
  signedTotalYen: string;
  /** 円単位の非負整数（10 進の文字列）。 */
  amountYen: string;
  fromUserId: string | null;
  toUserId: string | null;
  requiresTransfer: boolean;
};

/**
 * 対象の明細 1 件（支払いの詳細を含む）。確認応答の payment は確認時点の
 * 表示用値で、支払いの取り消し状態の変化は PreviewValidation を参照する。
 */
export type TargetItem = {
  payment: Payment;
  /** BASE は戻しでない対象（寄与 c）、REVERSAL は戻し（−c）。 */
  kind: "BASE" | "REVERSAL";
  /** 参加者番号 1 の人から 0 の人への向きを正とする円単位整数（10 進の文字列）。 */
  signedContributionYen: string;
  /** REVERSAL の戻す対象の精算。BASE なら null。 */
  baseSettlementId: string | null;
};

/**
 * 確認の、取得時点の検証結果。完了の POST では必ず再検証する（ここは参考値）。
 */
export type PreviewValidation = {
  status:
    | "ready"
    | "cancelled_items_ack_required"
    | "target_changed"
    | "already_completed"
    | "completed_then_cancelled";
  /** 確認の後で取り消された BASE 対象の支払い ID 全部。 */
  cancelledPaymentIds: string[];
  /** 確認の指紋と今の指紋が違う対象の支払い ID 全部。 */
  changedPaymentIds: string[];
  /** この確認にすでに紐づく精算。無ければ null。 */
  existingSettlementId: string | null;
};

/** 受け渡しの確認。固定した明細・金額はあとから変わらない。 */
export type Preview = {
  id: string;
  tripId: string;
  createdBy: string;
  /** ISO 8601 の日時。 */
  createdAt: string;
  participants: [Participant, Participant];
  transfer: Transfer;
  items: TargetItem[];
  validation: PreviewValidation;
};

/** 確認の一覧の 1 件。 */
export type PreviewSummary = {
  id: string;
  /** ISO 8601 の日時。 */
  createdAt: string;
  transfer: Transfer;
  targetCount: number;
  validation: PreviewValidation;
};

/** 確認の一覧の 1 ページ（自分の未完了だけ、新しい順）。 */
export type PreviewPage = {
  items: PreviewSummary[];
  nextCursor: string | null;
};

/** 残額（向き・金額・対象の件数・明細）。保存済みの支払い・精算・取り消しから導出する。 */
export type Balance = {
  tripId: string;
  participants: [Participant, Participant];
  transfer: Transfer;
  targetCount: number;
  items: TargetItem[];
  /** ISO 8601 の日時。スナップショットを読んだ時点。 */
  fetchedAt: string;
};
