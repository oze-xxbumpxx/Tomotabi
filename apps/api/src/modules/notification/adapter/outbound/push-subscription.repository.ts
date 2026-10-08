import type { UnitOfWork } from "../../../../adapter/transaction/unit-of-work";
import type { UserId } from "../../../../common/domain/user-id";

export const NOTIFICATION_UNIT_OF_WORK = Symbol("NOTIFICATION_UNIT_OF_WORK");

/**
 * notification.push_subscriptionsの1行。宛先と鍵を含むため、
 * この行をそのまま応答やログに出してはいけない。
 */
export type PushSubscriptionRow = Readonly<{
  id: string;
  userId: UserId;
  endpoint: string;
  endpointHash: Buffer;
  p256dh: Buffer;
  authSecret: Buffer;
  expirationTime: Date | null;
  registrationSessionId: string;
  deviceLabel: string;
  vapidKeyId: string;
  enabled: boolean;
  revision: bigint;
  createdAt: Date;
  updatedAt: Date;
}>;

/**
 * 新規登録の入力。idは実装側がrandomUUID()で振り、
 * created_at・updated_atは渡された時刻を入れる。
 * revisionはDBの既定（1）に任せる。
 */
export type NewPushSubscription = Readonly<{
  userId: UserId;
  endpoint: string;
  endpointHash: Buffer;
  p256dh: Buffer;
  authSecret: Buffer;
  expirationTime: Date | null;
  registrationSessionId: string;
  deviceLabel: string;
  vapidKeyId: string;
}>;

/** 再登録で書き換える項目。enabledを戻してrevisionを1進める。 */
export type PushSubscriptionUpdate = Readonly<{
  endpoint: string;
  p256dh: Buffer;
  authSecret: Buffer;
  expirationTime: Date | null;
  registrationSessionId: string;
  deviceLabel: string;
  vapidKeyId: string;
}>;

/**
 * 購読の永続化。設計書「購読の登録」で、lockOwner→isSessionClosed→
 * disableExpired→findByEndpointHash→countEnabled→insert/updateの順を
 * 1トランザクションで行う限定集合。
 */
export interface PushSubscriptionRepository {
  /**
   * identity.usersの自分の行をFOR UPDATEで取る。登録・停止・
   * ログアウト前処理を同じ人について直列にするロック点。
   */
  lockOwner(userId: UserId): Promise<void>;

  /** closed_push_sessionsにセッションIDがあるか（停止の記録）。 */
  isSessionClosed(sessionId: string): Promise<boolean>;

  /**
   * 停止の記録にこのセッションを足す。同じsessionIdの行が
   * 既にあれば何もしない（ON CONFLICT DO NOTHING）。
   */
  closeSession(
    sessionId: string,
    userId: UserId,
    closedAt: Date,
  ): Promise<void>;

  /**
   * このセッションで登録した自分の有効な購読だけを無効にする
   * （版を上げる）。別のセッションで登録した購読は触らない。
   */
  disableByRegistrationSession(
    userId: UserId,
    sessionId: string,
    now: Date,
  ): Promise<void>;

  /**
   * 期限切れの自分の有効購読を無効にする（上限を数える前の整理）。
   * 戻り値は無効にした件数。
   */
  disableExpired(userId: UserId, now: Date): Promise<number>;

  /** endpoint_hashの一意な行を読む。無いときはnull。 */
  findByEndpointHash(
    endpointHash: Buffer,
  ): Promise<PushSubscriptionRow | null>;

  /** 自分の有効な購読の数。 */
  countEnabled(userId: UserId): Promise<number>;

  insert(
    input: NewPushSubscription,
    now: Date,
  ): Promise<PushSubscriptionRow>;

  /**
   * 中身の更新＋有効化。WHEREはidと持ち主（user_id）の両方に絞り、
   * 0件ならnull（読んでから持ち主が変わった競合。
   * 持ち主が変わった行は「他人の宛先」としてUseCaseが409にする）。
   * revisionを1進めてupdated_atを今にする
   * （「中身が同じなら版を上げない」の判定はUseCaseが行う）。
   */
  update(
    id: string,
    userId: UserId,
    input: PushSubscriptionUpdate,
    now: Date,
  ): Promise<PushSubscriptionRow | null>;

  /**
   * 他人の無効な行の引き取り。WHEREはidとenabled = falseに絞り、
   * 0件ならnull（読んでから有効に戻った、または先に引き取られた
   * 競合。UseCaseが「他人の宛先」として409にする）。持ち主を今の
   * 利用者に書き換え、中身を登録の内容で更新して有効にし、
   * revisionを1進めてupdated_atを今にする。
   */
  takeOver(
    id: string,
    userId: UserId,
    input: PushSubscriptionUpdate,
    now: Date,
  ): Promise<PushSubscriptionRow | null>;

  /**
   * 自分の有効な購読だけを無効にする。他人の・無い・
   * 既に無効のIDは0件更新で終わる（DELETEの情報を漏らさない冪等）。
   */
  disable(userId: UserId, id: string, now: Date): Promise<void>;

  /** 自分の購読を登録日時の順で全部読む（有効・無効の両方）。 */
  listByUser(userId: UserId): Promise<readonly PushSubscriptionRow[]>;
}

export type NotificationWorkContext = Readonly<{
  subscriptions: PushSubscriptionRepository;
}>;

export type NotificationUnitOfWork = UnitOfWork<NotificationWorkContext>;
