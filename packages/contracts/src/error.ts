export type ApiErrorBody = {
  code: string;
  message: string;
  requestId: string;
  retryable: boolean;
  /** 精算の競合で、同じ対象を済ませた既存の精算（あるときだけ）。 */
  existingSettlementId?: string;
  /** 確認の明細のうち指紋が変わった対象の支払いID（あるときだけ）。 */
  changedPaymentIds?: string[];
  /** 予定に有効な達成・予約がある競合で、既存の記録のID（あるときだけ）。 */
  existingRecordId?: string;
};
