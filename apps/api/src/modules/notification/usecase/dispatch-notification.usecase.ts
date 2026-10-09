import type { Clock } from "../../../adapter/clock/clock";
import { checkPushEndpoint } from "../domain/push-endpoint";
import type { NotificationEvent } from "../domain/notification-event";
import { buildNotificationMessage } from "../domain/notification-message";
import type {
  DispatchTarget,
  NotificationDispatchStore,
} from "../adapter/outbound/notification-dispatch-store";
import type {
  DispatchLog,
  DispatchResult,
} from "../adapter/outbound/dispatch-log.port";
import type { PushSender } from "../adapter/outbound/push-sender";
import type { VapidKeyringPort } from "../adapter/outbound/vapid-keyring.port";

/** 同時に送る件数の上限（設計書「送る部品」: 同時3件）。 */
const SEND_CONCURRENCY = 3;

/** HTTPの状態から結果の種類への写像（F-34・設計書「エラー処理」）。 */
function resultOf(status: number): DispatchResult {
  if (status >= 200 && status < 300) {
    return "accepted";
  }
  if (status === 404 || status === 410) {
    return "gone";
  }
  if (status === 400 || status === 401 || status === 403) {
    return "config_error";
  }
  // 429・5xx・3xx（転送は追わないのでそのまま返る）・その他は届かない。
  return "dropped";
}

/**
 * 保存のあとの通知の送る処理（設計書「保存のあとに送る流れ」）。
 * 送る相手と名前を1回の読み取りで取り、購読ごとに送る（同時3件）。
 * 送り直しはしない（F-33）。送る処理は保存のトランザクションの外で、
 * 送信・無効化が失敗しても業務の保存は変わらない（F-31）。
 */
export class DispatchNotificationUseCase {
  constructor(
    private readonly store: NotificationDispatchStore,
    private readonly keyring: VapidKeyringPort,
    private readonly sender: PushSender,
    private readonly clock: Clock,
    private readonly log: DispatchLog,
  ) {}

  async execute(event: NotificationEvent): Promise<void> {
    const context = await this.store.readDispatchContext({
      tripId: event.tripId,
      actorUserId: event.actorUserId,
    });
    if (context === null) {
      // 旅行か操作した人が消えた。届かないまま終える。
      return;
    }
    const message = buildNotificationMessage(event, {
      actorName: context.actorName,
      tripName: context.tripName,
    });
    await this.sendAll(event, message.payload, context.targets);
  }

  /** 購読ごとに、先の1件が終わってから次が始まる同時3件で送る。 */
  private async sendAll(
    event: NotificationEvent,
    payload: string,
    targets: readonly DispatchTarget[],
  ): Promise<void> {
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < targets.length) {
        const index = next;
        next += 1;
        const target = targets[index];
        if (target !== undefined) {
          await this.sendOne(event, payload, target);
        }
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.min(SEND_CONCURRENCY, targets.length) },
        () => worker(),
      ),
    );
  }

  private async sendOne(
    event: NotificationEvent,
    payload: string,
    target: DispatchTarget,
  ): Promise<void> {
    const startedAt = Date.now();
    // 宛先の決まりは送るときにも確かめる（登録時に加えて。N-01・PD-21）。
    const endpointCheck = checkPushEndpoint(target.endpoint);
    if (!endpointCheck.ok) {
      this.log.info({
        eventId: event.eventId,
        subscriptionId: target.subscriptionId,
        result: "dropped",
        status: null,
        durationMs: Date.now() - startedAt,
        reason: endpointCheck.reason,
      });
      return;
    }
    const key = this.keyring.keyFor(target.vapidKeyId);
    if (
      key === null ||
      key.state === "revoked" ||
      key.privateKey === null ||
      key.publicKey === null
    ) {
      // revoked・一覧に無い鍵の購読には送らない（F-72）。
      this.log.info({
        eventId: event.eventId,
        subscriptionId: target.subscriptionId,
        result: "dropped",
        status: null,
        durationMs: Date.now() - startedAt,
        reason: "key_unavailable",
      });
      return;
    }
    const snapshot = this.keyring.snapshot;
    if (snapshot.status !== "ready") {
      this.log.info({
        eventId: event.eventId,
        subscriptionId: target.subscriptionId,
        result: "dropped",
        status: null,
        durationMs: Date.now() - startedAt,
        reason: "key_unavailable",
      });
      return;
    }
    let outcome: { status: number; durationMs: number };
    try {
      outcome = await this.sender.send({
        endpoint: endpointCheck.endpoint,
        p256dh: target.p256dh,
        authSecret: target.authSecret,
        vapidKey: key,
        subject: snapshot.subject,
        payload,
      });
    } catch {
      // 通信の失敗・時間切れは届かない（dropped）。例外のmessageには
      // 宛先や鍵が入り得るため、ログに出さない。
      this.log.info({
        eventId: event.eventId,
        subscriptionId: target.subscriptionId,
        result: "dropped",
        status: null,
        durationMs: Date.now() - startedAt,
      });
      return;
    }
    const result = resultOf(outcome.status);
    const entry = {
      eventId: event.eventId,
      subscriptionId: target.subscriptionId,
      result,
      status: outcome.status,
      durationMs: outcome.durationMs,
    };
    if (result === "config_error") {
      this.log.warn(entry);
    } else {
      this.log.info(entry);
    }
    if (result === "gone") {
      // 404・410は購読が無い・期限切れ。読んだときと版が同じときだけ
      // 無効にする（F-35。登録し直しで版が上がっていたら触らない）。
      await this.store.disableIfSameRevision(
        target.subscriptionId,
        target.revision,
        this.clock.now(),
      );
    }
  }
}
