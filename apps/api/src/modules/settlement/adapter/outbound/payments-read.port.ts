import type {
  Payment,
  PaymentCancellation,
} from "../../../record/domain/payment";

/**
 * 支払いの読み取り口。settlementの業務処理はrecordの支払いをこの
 * ポート越しに読む（recordからsettlementの業務処理を呼ばない、
 * という向きの逆側。設計書「バックエンド設計」）。
 */
export interface PaymentsReadPort {
  /** 旅行の支払いを記録順（created_at, idの昇順）で返す。 */
  listInTrip(tripId: string): Promise<readonly Payment[]>;
  /** 旅行の支払いの取り消し記録を全件返す（payment_idで引く用）。 */
  listCancellationsInTrip(
    tripId: string,
  ): Promise<readonly PaymentCancellation[]>;
}
