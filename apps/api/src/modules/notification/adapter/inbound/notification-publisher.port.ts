import type { NotificationEvent } from "../../domain/notification-event";

/**
 * ほかのモジュールから保存のあとの通知のイベントを受け取る口
 * （設計書「イベントを渡す口」「モジュールの置き場」）。
 * planning・record・settlementの各NotificationPublisherと同じ形。
 * notificationはほかのモジュールの中を見ないため、同じ形の口を
 * このモジュールの中に置く。publishは例外を投げない
 * （中で受け止めてログに出す）。
 */
export interface NotificationPublisher {
  publish(event: NotificationEvent): void;
}
