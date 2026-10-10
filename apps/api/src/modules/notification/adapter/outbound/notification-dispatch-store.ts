import type { UserId } from "../../../../common/domain/user-id";

export const NOTIFICATION_DISPATCH_STORE = Symbol(
  "NOTIFICATION_DISPATCH_STORE",
);

/**
 * 送る相手の購読1件。宛先と鍵を含むため、応答やログにそのまま出しては
 * いけない。revisionは無効化が「読んだときと同じ版」の判定に使う。
 */
export type DispatchTarget = Readonly<{
  subscriptionId: string;
  userId: UserId;
  endpoint: string;
  p256dh: Buffer;
  authSecret: Buffer;
  vapidKeyId: string;
  revision: bigint;
}>;

/**
 * 1回の読み取りで返す送るための文脈（設計書「送る処理」:
 * 相手の購読と、相手の名前・旅行の名前）。旅行か操作した人の行が
 * 無いときはnull（対象が消えた。届かないまま終える）。
 */
export type DispatchContext = Readonly<{
  actorName: string;
  tripName: string;
  targets: readonly DispatchTarget[];
}>;

/**
 * 送る処理のDBの読み取り・無効化（設計書「送る処理」）。
 * 読み取りはREAD ONLYで`statement_timeout`・`lock_timeout`を2秒にした
 * トランザクション、無効化も同じ上限の別トランザクションで行う。
 */
export interface NotificationDispatchStore {
  /**
   * 送る相手と名前2つを1回の読み取りで返す。
   * 相手は旅行の参加者から操作した人を除き、allowed_google_accountsの
   * enabledが今もtrueの人。その人の購読のうち、enabledで、期限が過ぎて
   * おらず、登録したセッションが停止の記録に無く、identity.sessionsに
   * 残っていてexpires_atが今より後のものだけ。
   */
  readDispatchContext(input: Readonly<{
    tripId: string;
    actorUserId: UserId;
  }>): Promise<DispatchContext | null>;

  /**
   * 404・410の購読を、読んだときと版が同じときだけ無効にする（F-35）。
   * 送っている間に登録し直されて版が上がっていたら無効にしない
   * （戻り値false）。無効にしたらrevisionを1進める。
   */
  disableIfSameRevision(
    subscriptionId: string,
    revision: bigint,
    now: Date,
  ): Promise<boolean>;
}
