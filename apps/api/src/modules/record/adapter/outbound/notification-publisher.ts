import type { NotificationEvent } from "../../../notification/domain/notification-event";

export const NOTIFICATION_PUBLISHER = Symbol("NOTIFICATION_PUBLISHER");

/**
 * 保存のあとの通知のイベントを渡す口（設計書「イベントを渡す口」）。
 * UseCaseはCOMMITが成功し、再送でなく、状態が実際に変わったときだけ呼ぶ。
 * publishは例外を投げない（中で受け止めてログに出す）。
 */
export interface NotificationPublisher {
  publish(event: NotificationEvent): void;
}

/**
 * 何もしない実装。通知の配線が要らない場面（今の保存の試験など）の既定。
 */
export const noopNotificationPublisher: NotificationPublisher = {
  publish: () => {},
};
