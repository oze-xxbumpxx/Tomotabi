import type { TimelineItemKind } from "@tomotabi/contracts";
import type { UnitOfWork } from "../../../../adapter/transaction/unit-of-work";
import type { UserId } from "../../../../common/domain/user-id";
import type { Payment, PaymentCancellation } from "../../domain/payment";
import type { TripRosterPort } from "./finance-work-context";

export const RECORDS_READ_UNIT_OF_WORK = Symbol("RECORDS_READ_UNIT_OF_WORK");

/** 記録の一覧の絞り込みに使う元の記録の種類（typeクエリの値）。 */
export type RecordType = "achievement" | "booking" | "payment";

/**
 * 記録の一覧の1行目のクエリが返す行。種類・ID・登録日時・誰が・
 * 予定のID・元の記録のID（設計書「記録の一覧とホーム」）。
 * 取り消しの行は`id`・`targetId`とも元の記録のIDで、`actorId`は
 * 取り消した人。`createdAt`は元の記録ではなく取り消しの登録日時。
 */
export type RecordTimelineRow = Readonly<{
  id: string;
  tripId: string;
  kind: TimelineItemKind;
  createdAt: Date;
  actorId: UserId;
  planId: string | null;
  targetId: string;
}>;

/**
 * 一覧のページ位置（カーソルの起点）。`createdAt`はDBの
 * `created_at::text`の値で、Dateに変換すると失うマイクロ秒が保たれる
 * （trip-cursor.tsと同じ仕組み）。
 */
export type RecordTimelineAnchor = Readonly<{
  createdAt: string;
  kind: TimelineItemKind;
  id: string;
}>;

export type RecordsTimelineQuery = Readonly<{
  /** 元の記録の種類で絞る。取り消しの行も含む。無指定はnull。 */
  type: RecordType | null;
  /** 関連する予定で絞る。無指定はnull。 */
  planId: string | null;
  /** 元の記録のIDで1件に絞る。一覧モードはnull。 */
  recordId: string | null;
  /** この位置より古い行を読む。最初のページはnull。 */
  after: RecordTimelineAnchor | null;
  limit: number;
}>;

export type RecordsTimelinePage = Readonly<{
  items: readonly RecordTimelineRow[];
  /** 次のページがあるとき、最後の行のカーソル起点（種類とID）。 */
  nextAnchor: Readonly<{ kind: TimelineItemKind; id: string }> | null;
}>;

/** 達成・予約の取り消し（record.plan_event_cancellations）。 */
export type PlanEventCancellation = Readonly<{
  eventId: string;
  tripId: string;
  cancelledBy: UserId;
  createdAt: Date;
}>;

/**
 * 記録の一覧の読み取り。支払い・支払いの取り消し・達成と予約・
 * その取り消しを1つのSQL（UNION ALL）で並べる。ホームのAPIが
 * 最近の記録にも使う公開の照会。
 */
export interface RecordsReadPort {
  /**
   * カーソルの起点の行をこの旅行の記録から引く。kindとidで1行に
   * 決まる（取り消しの行は元の記録と同じIDなので種類が要る）。
   * 無い・別の旅行の行を指すときはnull。
   */
  findAnchor(
    tripId: string,
    kind: TimelineItemKind,
    id: string,
  ): Promise<RecordTimelineAnchor | null>;

  /**
   * 登録日時の新しい順・同じ日時は種類・IDの順に並んだ1ページを返す。
   * `limit+1`件読んで次の有無を判定する。
   */
  listTimeline(
    tripId: string,
    query: RecordsTimelineQuery,
  ): Promise<RecordsTimelinePage>;

  /** ページに出す支払いの中身をまとめて読む。 */
  listPaymentsByIds(
    tripId: string,
    paymentIds: readonly string[],
  ): Promise<readonly Payment[]>;

  /** ページに出す支払いの取り消しをまとめて読む。 */
  listPaymentCancellationsByIds(
    tripId: string,
    paymentIds: readonly string[],
  ): Promise<readonly PaymentCancellation[]>;

  /** ページに出す達成・予約の取り消しをまとめて読む。 */
  listPlanEventCancellationsByIds(
    tripId: string,
    eventIds: readonly string[],
  ): Promise<readonly PlanEventCancellation[]>;
}

/**
 * 記録の一覧の読み取りの文脈。REPEATABLE READ・READ ONLYの短い
 * トランザクションで、一覧と中身を同じ時点のデータから組み立てる
 * （詳細設計「読み取り」）。書き込みの口は持たない。
 */
export interface RecordsReadContext {
  roster: TripRosterPort;
  records: RecordsReadPort;
}

export type RecordsReadUnitOfWork = UnitOfWork<RecordsReadContext>;
