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
}
