import type { UserId } from "../../../../common/domain/user-id";
import type { SignedYen } from "../../../../common/domain/yen";
import type { ClaimHistory } from "../../domain/fingerprint";
import type { ActiveClaim, ClaimKind } from "../../domain/settlement-target";

/** 確認の行（settlement.previews）。 */
export type PreviewRecord = Readonly<{
  id: string;
  tripId: string;
  createdBy: UserId;
  createdAt: Date;
  /** 明細の寄与の合計（参加者番号1の人から0の人への向きを正）。 */
  signedTotal: SignedYen;
}>;

/** 確認の明細の行（settlement.preview_items）。 */
export type PreviewItemRecord = Readonly<{
  paymentId: string;
  kind: ClaimKind;
  /** BASEはその支払いの寄与c、REVERSALは −c。 */
  contribution: SignedYen;
  /** REVERSALの戻す対象のBASEを済ませた精算。BASEならnull。 */
  baseSettlementId: string | null;
  /** 確認を作った時点の、その支払いの精算・占有・取り消し履歴の指紋。 */
  expectedFingerprint: string;
  /** 確認を作った時点の、その支払いの取り消し状態。 */
  expectedCancelled: boolean;
}>;

/** 確認に紐づく精算の存在と取り消し状態（UNIQUE preview_idで高々1件）。 */
export type ExistingSettlement = Readonly<{
  id: string;
  cancelled: boolean;
}>;

/**
 * 完了の記録の種類（settlement.settlements.completion_kind）。
 * 非 0 円は受け渡しを完了した、0 円は受け渡し不要（DB の CHECK と同じ対応）。
 */
export type SettlementCompletionKind =
  | "transfer_completed"
  | "no_transfer_required";

/** 精算の行（settlement.settlements）。 */
export type SettlementRecord = Readonly<{
  id: string;
  tripId: string;
  previewId: string;
  /** 旅行の中の連番（guard の行から 1 から払い出す）。 */
  sequence: number;
  createdBy: UserId;
  createdAt: Date;
  signedTotal: SignedYen;
  completionKind: SettlementCompletionKind;
}>;

/** 精算の明細の行（settlement.items）。 */
export type SettlementItemRecord = Readonly<{
  paymentId: string;
  kind: ClaimKind;
  /** BASE はその支払いの寄与 c、REVERSAL は −c。 */
  contribution: SignedYen;
  /** REVERSAL の戻す対象の BASE を済ませた精算。BASE なら null。 */
  baseSettlementId: string | null;
}>;

/** 精算の取り消しの行（settlement.cancellations）。 */
export type SettlementCancellationRecord = Readonly<{
  settlementId: string;
  tripId: string;
  cancelledBy: UserId;
  createdAt: Date;
}>;

/** 精算の一覧の 1 行（取り消しの記録を左結合で持つ）。 */
export type SettlementListRow = SettlementRecord &
  Readonly<{ cancellation: SettlementCancellationRecord | null }>;

export type NewSettlement = Readonly<{
  tripId: string;
  previewId: string;
  sequence: number;
  createdBy: UserId;
  signedTotal: SignedYen;
  completionKind: SettlementCompletionKind;
}>;

export type NewSettlementItem = Readonly<{
  paymentId: string;
  kind: ClaimKind;
  contribution: SignedYen;
  baseSettlementId: string | null;
}>;

export type NewSettlementCancellation = Readonly<{
  settlementId: string;
  tripId: string;
  cancelledBy: UserId;
}>;

/** 精算の一覧のページの起点（連番の降順の続き）。 */
export type SettlementAnchor = Readonly<{
  sequence: number;
}>;

export type SettlementPage = Readonly<{
  items: readonly SettlementListRow[];
  /** 次のページの起点になる精算。無ければ null。 */
  nextCursorId: string | null;
}>;

/** 取り消せるかの判定に使う、最新の有効な精算（あれば 1 件）。 */
export type LatestActiveSettlement = Readonly<{
  id: string;
  sequence: number;
}>;

export type NewPreview = Readonly<{
  tripId: string;
  createdBy: UserId;
  signedTotal: SignedYen;
}>;

export type NewPreviewItem = Readonly<{
  paymentId: string;
  kind: ClaimKind;
  contribution: SignedYen;
  baseSettlementId: string | null;
  expectedFingerprint: string;
  expectedCancelled: boolean;
}>;

/**
 * 一覧のページの起点。(created_at, id)のタプル比較に使うので、
 * created_atはミリ秒に丸めないDB側の文字列表現のまま持つ
 * （trip-cursor / findTripAnchorと同じ仕組み）。
 */
export type PreviewAnchor = Readonly<{
  createdAt: string;
  id: string;
}>;

export type PreviewPage = Readonly<{
  items: readonly PreviewRecord[];
  /** 次のページの起点になる確認。無ければnull。 */
  nextCursorId: string | null;
}>;

/**
 * settlementスキーマのRepository（確認・精算・取り消し・占有）。
 * 更新はしない（追記のみの履歴表＋占有の消去）。UoWのトランザクション内の
 * dbハンドルを受けて使う。
 */
export interface SettlementRepository {
  insertPreview(preview: NewPreview): Promise<PreviewRecord>;

  insertPreviewItems(
    previewId: string,
    tripId: string,
    items: readonly NewPreviewItem[],
  ): Promise<void>;

  /** 旅行の中の確認。無い・別の旅行の確認はnull（どちらも同じ扱い）。 */
  findPreviewInTrip(
    tripId: string,
    previewId: string,
  ): Promise<PreviewRecord | null>;

  /**
   * 確認の明細を支払いの記録順（payments.created_at, idの昇順）で返す。
   * 複数の確認の明細は1回の問い合わせでまとめて取り、確認idごとに
   * まとめて返す（一覧で確認ごとに1回ずつ問い合わせないため）。
   */
  listPreviewItems(
    tripId: string,
    previewIds: readonly string[],
  ): Promise<ReadonlyMap<string, readonly PreviewItemRecord[]>>;

  /** その確認に紐づく精算（あれば1件）。取り消しの有無を含む。 */
  findSettlementForPreview(
    tripId: string,
    previewId: string,
  ): Promise<ExistingSettlement | null>;

  /** 一覧カーソルの起点になる自分の確認。無ければnull。 */
  findPreviewAnchor(
    tripId: string,
    createdBy: UserId,
    previewId: string,
  ): Promise<PreviewAnchor | null>;

  /**
   * 自分が作った未完了の確認（精算がまだ無いもの）を新しい順に返す。
   * afterは排他の下限（その行より古い分だけ）。limit + 1件読んで次の
   * ページの有無を決める。
   */
  listPendingPreviews(
    tripId: string,
    createdBy: UserId,
    after: PreviewAnchor | null,
    limit: number,
  ): Promise<PreviewPage>;

  /** 旅行の占有（settlement.active_claims）全部。対象の導出に使う。 */
  listActiveClaims(tripId: string): Promise<readonly ActiveClaim[]>;

  /** 支払いごとの精算・占有・取り消し履歴（指紋の計算用）。 */
  claimHistories(
    tripId: string,
    paymentIds: readonly string[],
  ): Promise<ReadonlyMap<string, ClaimHistory>>;

  /** 旅行の中の精算。無い・別の旅行の精算は null（どちらも同じ扱い）。 */
  findSettlementInTrip(
    tripId: string,
    settlementId: string,
  ): Promise<SettlementRecord | null>;

  /** 精算の取り消し記録（あれば 1 件。PK settlement_id）。 */
  findSettlementCancellation(
    tripId: string,
    settlementId: string,
  ): Promise<SettlementCancellationRecord | null>;

  /** 一覧カーソルの起点になる精算の連番。無ければ null。 */
  findSettlementAnchor(
    tripId: string,
    settlementId: string,
  ): Promise<SettlementAnchor | null>;

  /**
   * 旅行の精算を連番の降順（新しい順）で返す。取り消しの記録を左結合で
   * 持つ。after は排他の上限（その連番より小さい分だけ）。limit + 1 件
   * 読んで次のページの有無を決める。
   */
  listSettlements(
    tripId: string,
    after: SettlementAnchor | null,
    limit: number,
  ): Promise<SettlementPage>;

  /**
   * 精算の明細を支払いの記録順（payments.created_at, id の昇順）で返す。
   * 複数の精算の明細は 1 回の問い合わせでまとめて取り、精算 id ごとに
   * まとめて返す（listPreviewItems と同じ仕組み）。
   */
  listSettlementItems(
    tripId: string,
    settlementIds: readonly string[],
  ): Promise<ReadonlyMap<string, readonly SettlementItemRecord[]>>;

  /** 旅行の最新の有効な精算（取り消されていないものの最大連番）。 */
  findLatestActiveSettlement(
    tripId: string,
  ): Promise<LatestActiveSettlement | null>;

  insertSettlement(settlement: NewSettlement): Promise<SettlementRecord>;

  insertSettlementItems(
    settlementId: string,
    tripId: string,
    previewId: string,
    items: readonly NewSettlementItem[],
  ): Promise<void>;

  /** 精算の対象ごとの占有（明細と同じ (payment_id, kind) の行）。 */
  insertActiveClaims(
    tripId: string,
    settlementId: string,
    items: readonly NewSettlementItem[],
  ): Promise<void>;

  insertSettlementCancellation(
    cancellation: NewSettlementCancellation,
  ): Promise<SettlementCancellationRecord>;

  /**
   * その精算の占有を消す（取り消しと同じトランザクションで呼ぶ。
   * 占有を先に消して別のトランザクションで取り消しを書く構成は禁止）。
   */
  deleteActiveClaimsForSettlement(
    tripId: string,
    settlementId: string,
  ): Promise<void>;
}
