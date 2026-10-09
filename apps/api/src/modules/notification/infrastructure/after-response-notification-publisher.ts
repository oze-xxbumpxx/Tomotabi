import type { AfterResponse } from "../../../adapter/after-response/after-response";
import type { NotificationEvent } from "../domain/notification-event";
import type { NotificationPublisher } from "../../planning/adapter/outbound/notification-publisher";
import type { DispatchNotificationUseCase } from "../usecase/dispatch-notification.usecase";

/** タスク名の接頭辞。ログに出す固定の語。 */
const TASK_PREFIX = "push-notification-dispatch";

/**
 * 各モジュールのNotificationPublisherの実装（設計書「モジュールの置き場」:
 * planning・record・settlementの各Compositionがnotificationの
 * AfterResponseNotificationPublisherを受け取る）。
 * publishは例外を投げない。送る処理は応答のあとに走らせるため、
 * AfterResponseに予約するだけで戻る（保存の応答を待たせない）。
 */
export class AfterResponseNotificationPublisher
  implements NotificationPublisher
{
  constructor(
    private readonly afterResponse: AfterResponse,
    private readonly dispatch: DispatchNotificationUseCase,
    private readonly logFailure: (entry: {
      eventId: string;
      errorType: string;
    }) => void,
  ) {}

  publish(event: NotificationEvent): void {
    try {
      this.afterResponse.schedule(
        `${TASK_PREFIX}:${event.eventId}`,
        () => this.dispatch.execute(event),
      );
    } catch (error) {
      this.logFailure({
        eventId: event.eventId,
        errorType:
          error instanceof Error ? error.constructor.name : typeof error,
      });
    }
  }
}
