export const DISPATCH_LOG = Symbol("DISPATCH_LOG");

/** 購読ごとの結果の種類（設計書「ログと監視」）。 */
export type DispatchResult = "accepted" | "gone" | "config_error" | "dropped";

/**
 * 送る処理の購読ごとの1行（設計書「ログと監視」）。
 * endpoint・鍵・本文・名前は出さない（N-02）。reasonは宛先の検査の
 * 固定の語・固定の断り語だけを入れる。
 */
export type DispatchLogEntry = Readonly<{
  eventId: string;
  subscriptionId: string;
  result: DispatchResult;
  /** HTTPの状態。応答が無いとき（通信の失敗・時間切れ・送信前の断り）はnull。 */
  status: number | null;
  durationMs: number;
  reason?: string;
}>;

/** 送る処理のログの口。config_errorはwarn、それ以外はinfoで出す。 */
export type DispatchLog = Readonly<{
  info(entry: DispatchLogEntry): void;
  warn(entry: DispatchLogEntry): void;
}>;
