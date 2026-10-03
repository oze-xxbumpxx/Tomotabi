import type { Cancellation } from "./plan";

/** 参加者1人分の負担。percentの合計は100。 */
export type PaymentAllocation = {
  userId: string;
  /** 0〜100の整数。 */
  percent: number;
  /** 円単位の非負整数（10進の文字列）。サーバーが計算して確定する。 */
  burdenYen: string;
};

/** 支払い1件（取り消し状態を含む）。金額は10進の整数文字列。 */
export type Payment = {
  id: string;
  tripId: string;
  /** 関連する予定。結んでいないときはnull。 */
  planId: string | null;
  /** 用途。無いときはnull。 */
  label: string | null;
  /** 円単位の非負整数（10進の文字列）。1〜9,999,999。 */
  amountYen: string;
  payerUserId: string;
  /** 参加者番号0, 1の順。二人分でpercentの合計は100。 */
  allocations: [PaymentAllocation, PaymentAllocation];
  createdBy: string;
  /** ISO 8601の日時。 */
  createdAt: string;
  cancellation: Cancellation | null;
};

/** 旅行の参加者1人（残額・確認の向き表示に使う）。 */
export type Participant = {
  userId: string;
  /** 参加者番号（0・1）。 */
  slot: 0 | 1;
  displayName: string;
};

/**
 * 受け渡しの向きと金額。0円ならfrom/toはnullでrequiresTransferはfalse。
 * 非0ならfromとtoは異なる旅行参加者（サーバーが整合性を保証する）。
 */
export type Transfer = {
  /** 参加者番号1の人から0の人への向きを正とする円単位整数（10進の文字列）。 */
  signedTotalYen: string;
  /** 円単位の非負整数（10進の文字列）。 */
  amountYen: string;
  fromUserId: string | null;
  toUserId: string | null;
  requiresTransfer: boolean;
};

/**
 * 対象の明細1件（支払いの詳細を含む）。確認応答のpaymentは確認時点の
 * 表示用値で、支払いの取り消し状態の変化はPreviewValidationを参照する。
 */
export type TargetItem = {
  payment: Payment;
  /** BASEは戻しでない対象（寄与c）、REVERSALは戻し（−c）。 */
  kind: "BASE" | "REVERSAL";
  /** 参加者番号1の人から0の人への向きを正とする円単位整数（10進の文字列）。 */
  signedContributionYen: string;
  /** REVERSALの戻す対象の精算。BASEならnull。 */
  baseSettlementId: string | null;
};

/**
 * 確認の、取得時点の検証結果。完了のPOSTでは必ず再検証する（ここは参考値）。
 */
export type PreviewValidation = {
  status:
    | "ready"
    | "cancelled_items_ack_required"
    | "target_changed"
    | "already_completed"
    | "completed_then_cancelled";
  /** 確認の後で取り消されたBASE対象の支払いID全部。 */
  cancelledPaymentIds: string[];
  /** 確認の指紋と今の指紋が違う対象の支払いID全部。 */
  changedPaymentIds: string[];
  /** この確認にすでに紐づく精算。無ければnull。 */
  existingSettlementId: string | null;
};

/** 受け渡しの確認。固定した明細・金額はあとから変わらない。 */
export type Preview = {
  id: string;
  tripId: string;
  createdBy: string;
  /** ISO 8601の日時。 */
  createdAt: string;
  participants: [Participant, Participant];
  transfer: Transfer;
  items: TargetItem[];
  validation: PreviewValidation;
};

/** 確認の一覧の1件。 */
export type PreviewSummary = {
  id: string;
  /** ISO 8601の日時。 */
  createdAt: string;
  transfer: Transfer;
  targetCount: number;
  validation: PreviewValidation;
};

/** 確認の一覧の1ページ（自分の未完了だけ、新しい順）。 */
export type PreviewPage = {
  items: PreviewSummary[];
  nextCursor: string | null;
};

/** 精算を取り消せない理由（取り消せるときはnull）。 */
export type CannotCancelReason = "not_latest" | "already_cancelled" | null;

/**
 * 完了した受け渡し（精算）。旅行内連番・元の確認・明細・取り消し履歴を
 * 含む。完了と取り消しは同じ精算で1回ずつだけ成立する。
 */
export type Settlement = {
  id: string;
  tripId: string;
  previewId: string;
  /** 旅行の中の連番（1からの10進の文字列）。 */
  sequence: string;
  createdBy: string;
  /** ISO 8601の日時。 */
  createdAt: string;
  /** 非0円は受け渡しを完了した申告、0円は受け渡し不要。 */
  completionKind: "transfer_completed" | "no_transfer_required";
  transfer: Transfer;
  items: TargetItem[];
  cancellation: Cancellation | null;
  /** 今取り消せるか（最新の有効な精算のときだけtrue）。 */
  canCancel: boolean;
  cannotCancelReason: CannotCancelReason;
};

/** 精算の一覧の1ページ（旅行内連番の降順。取り消し済みを含む）。 */
export type SettlementPage = {
  items: Settlement[];
  nextCursor: string | null;
};

/** 残額（向き・金額・対象の件数・明細）。保存済みの支払い・精算・取り消しから導出する。 */
export type Balance = {
  tripId: string;
  participants: [Participant, Participant];
  transfer: Transfer;
  targetCount: number;
  items: TargetItem[];
  /** ISO 8601の日時。スナップショットを読んだ時点。 */
  fetchedAt: string;
};
