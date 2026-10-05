import type { Transfer } from "./finance";
import type { Plan } from "./plan";
import type { TimelineItem } from "./record";
import type { Trip } from "./trip";

/** 表示の種類（F-41）。終了していればcompleted、未終了なら日付で分ける。 */
export type ContextMode = "before" | "during" | "after_dates" | "completed";

/** 画面が案内する次の操作。出せる操作が無いときはnull。 */
export type ContextSuggestedAction = "start" | "finish" | null;

/**
 * ホームの表示の文脈。`YYYY-MM-DD`のtodayを基準にサーバーが決め、
 * 画面は日付から計算し直さない。
 */
export type Context = {
  /** `YYYY-MM-DD`（日本時間の今日）。 */
  today: string;
  mode: ContextMode;
  /** 予定の欄の対象日。`YYYY-MM-DD`。欄を出さない種類ではnull。 */
  targetDate: string | null;
  /** 期間中は1始まりの「何日目」。それ以外はnull。 */
  dayNumber: number | null;
  /** 出発前は0以上の「出発までの日数」。それ以外はnull。 */
  daysUntilStart: number | null;
  suggestedAction: ContextSuggestedAction;
};

/** 予定の欄。取りやめていない予定の、未達成優先の最大3件と件数。 */
export type Schedule = {
  /** `YYYY-MM-DD`。対象日。 */
  date: string;
  /** 最大3件。達成済みも`achievement`を持って入ることがある。 */
  items: Plan[];
  /** その日の取りやめていない予定の全件数。 */
  totalCount: number;
  /** 有効な達成が付いている予定の件数（「達成済み N 件」のN）。 */
  achievedCount: number;
};

/** 精算の欄。誰から誰へいくらと、次回の対象の件数。 */
export type BalanceSummary = {
  transfer: Transfer;
  targetCount: number;
};

/**
 * 欄の取得結果。読み取りに失敗した欄だけ`unavailable`にし、
 * ほかの欄は返る（F-48）。
 */
export type HomeSection<T> =
  | { status: "ok"; data: T }
  | { status: "unavailable"; code: "TEMPORARILY_UNAVAILABLE" };

/** ホーム（F-40）。1回の呼び出しで同じ時点の読み取りをまとめて返す。 */
export type Home = {
  trip: Trip;
  context: Context;
  /** 終了後・期間が過ぎたときは`data: null`（欄自体を出さない）。 */
  schedule: HomeSection<Schedule | null>;
  balance: HomeSection<BalanceSummary>;
  /** 最大3件。 */
  recentRecords: HomeSection<TimelineItem[]>;
  /** ISO 8601の日時。読み取りを組み立てた時刻。 */
  fetchedAt: string;
};
