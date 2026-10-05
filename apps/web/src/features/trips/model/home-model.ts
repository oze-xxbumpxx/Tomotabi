import type { Me, Participant, Trip } from "@tomotabi/contracts";
import type {
  ContextMode,
  Home,
  Schedule,
  TimelineItem,
} from "../api/trips-api";
import {
  daysOfPeriod,
  formatLocalDate,
  formatTripPeriod,
} from "@/shared/lib/local-date";

/**
 * ホームの見た目を決める純粋な関数。APIの`context`をそのまま使い、
 * 表示の種類を日付から計算し直さない（F-41・設計書「ホーム」）。
 */

/** 予定の欄の題字。表示するのは出発前と期間中だけ。 */
export function scheduleTitleOf(mode: ContextMode): string {
  return mode === "before" ? "初日の予定" : "今日の予定";
}

/**
 * ヘッダーの日付の行（v3の`dateText`）。
 * - 期間中: `10/13 日 · 2 / 3 日目`
 * - 出発前: `出発まで 5 日 · 10/12 土 から`
 * - 終了後: `終了 · 10/12 土 – 10/14 月`
 * - 期間が過ぎた: 期間（帯が「期間が終わりました」を担う）
 */
export function headerDateTextOf(home: Home): string {
  const { context, trip } = home;
  switch (context.mode) {
    case "during": {
      const days = daysOfPeriod(trip.startsOn, trip.endsOn).length;
      return `${formatLocalDate(context.today)} · ${context.dayNumber ?? "-"} / ${days} 日目`;
    }
    case "before":
      return `出発まで ${context.daysUntilStart ?? "-"} 日 · ${formatLocalDate(
        trip.startsOn,
      )} から`;
    case "completed":
      return `終了 · ${formatTripPeriod(trip.startsOn, trip.endsOn)}`;
    case "after_dates":
      return formatTripPeriod(trip.startsOn, trip.endsOn);
  }
}

/**
 * ヘッダー下の4pxの帯（旅行の期間の日ごとに1本）。過ぎた日は塗り、
 * 今日は途中まで塗る（割合は今の時刻から）。出発前は全部空。
 */
export type HomeBar = "past" | "today" | "future";

export function homeBarsOf(context: Home["context"], trip: Trip): HomeBar[] {
  const days = daysOfPeriod(trip.startsOn, trip.endsOn);
  switch (context.mode) {
    case "before":
      return days.map(() => "future");
    case "completed":
    case "after_dates":
      return days.map(() => "past");
    case "during": {
      const dayNumber = context.dayNumber ?? 1;
      return days.map((_, index) =>
        index + 1 < dayNumber
          ? "past"
          : index + 1 === dayNumber
            ? "today"
            : "future",
      );
    }
  }
}

/**
 * 予定の欄の「ほか N 件」。`totalCount`から達成済み（「達成済み N 件」の
 * 行にまとめる分）と出した未達成の予定を除いた残り。APIが`items`に
 * 達成済みを入れても入れなくても同じ数になるよう、0未満にはしない
 * （F-44）。
 */
export function hiddenCountOf(
  schedule: Pick<Schedule, "totalCount" | "achievedCount">,
  shownCount: number,
): number {
  return Math.max(0, schedule.totalCount - schedule.achievedCount - shownCount);
}

/**
 * 名前の解決。公開APIに参加者一覧を返す道は残額（balance）しか無い
 * ので、参加者に無い相手は「相手」と出す（精算の`nameOf`と同じ考え方。
 * 自分だけは利用者の表示名を使う）。
 */
export function displayNameOf(
  userId: string,
  participants: Participant[] | null,
  me: Me | null,
): string {
  const participant = participants?.find((p) => p.userId === userId);
  if (participant !== undefined) {
    return participant.displayName;
  }
  if (me !== null && me.user.id === userId) {
    return me.user.displayName;
  }
  return "相手";
}

/** 記録の行の動詞（`name が〜`の形）。 */
const RECORD_VERB: Record<TimelineItem["kind"], string> = {
  achievement: "達成",
  booking: "予約",
  payment: "支払い",
  achievement_cancellation: "取り消し",
  booking_cancellation: "取り消し",
  payment_cancellation: "取り消し",
};

export function recordVerbOf(item: TimelineItem): string {
  return RECORD_VERB[item.kind];
}

/** 記録が取り消しの行か（「〜を取り消し」と出す）。 */
export function isCancellationItem(item: TimelineItem): boolean {
  return item.kind.endsWith("_cancellation");
}

/**
 * 記録の行の見出し。達成・予約（とその取り消し）は関連する予定の名前、
 * 支払いは`label`（無ければ「支払い」）。取り消しの行は元の名前が
 * 分からないときも種類の名を出す。
 */
export function recordTitleOf(
  item: TimelineItem,
  planNameOf: (planId: string | null) => string | null,
  paymentLabelOf: (paymentId: string) => string | null,
): string {
  switch (item.kind) {
    case "payment": {
      const label =
        "label" in item.detail ? item.detail.label : null;
      return label ?? "支払い";
    }
    case "payment_cancellation":
      return `${paymentLabelOf(item.id) ?? "支払い"}を取り消し`;
    case "achievement":
    case "booking":
      return planNameOf(item.planId) ?? "予定";
    case "achievement_cancellation":
    case "booking_cancellation":
      return `${planNameOf(item.planId) ?? "予定"}を取り消し`;
  }
}

/**
 * 元の記録が取り消されている行（取消線と「取り消し済み」を出す）。
 * 取り消しの行自身は対象外。
 */
export function recordVoided(item: TimelineItem): boolean {
  return (
    !isCancellationItem(item) &&
    "cancellation" in item.detail &&
    item.detail.cancellation !== null
  );
}
