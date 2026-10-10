export const AFTER_RESPONSE = Symbol("AFTER_RESPONSE");

/**
 * 保存のあとの処理の口（設計書「イベントを渡す口」「保存のあとの処理の口」）。
 * 応答を返したあとに走らせる仕事を予約する。scheduleは例外を投げず、
 * タスクの失敗は実装側がログに出す（業務の保存を巻き戻さない。F-31）。
 */
export interface AfterResponse {
  /**
   * 応答のあとに走らせる仕事を予約する。nameはログに出す固定の語。
   * taskが例外・拒否になっても呼び出し側には伝わらない。
   */
  schedule(name: string, task: () => Promise<void>): void;

  /**
   * 予約済みのタスクが全部終わるまで待つ。試験が送る処理の完了を
   * 待つために使う（sleepしない）。
   */
  drain(): Promise<void>;
}
