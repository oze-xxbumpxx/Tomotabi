import type { Trip } from "./trip";

export type PlanKind = "place" | "food" | "shopping" | "lodging" | "transport";

export type EventKind = "achievement" | "booking";

export type Cancellation = {
  targetId: string;
  cancelledBy: string;
  /** ISO 8601 の日時。 */
  createdAt: string;
};

export type PlanEvent = {
  id: string;
  tripId: string;
  planId: string;
  kind: EventKind;
  createdBy: string;
  /** ISO 8601 の日時。 */
  createdAt: string;
  cancellation: Cancellation | null;
};

export type Plan = {
  id: string;
  tripId: string;
  name: string;
  kind: PlanKind;
  /** `YYYY-MM-DD`。旅行の期間内の日付。 */
  date: string;
  /**
   * 日本の現地時刻 `HH:mm`。時刻未定は null で、`00:00`（0 時ちょうどの
   * 確定した時刻）とは区別する。
   */
  time: string | null;
  memo: string | null;
  /**
   * 取りやめ日時（ISO 8601）。cancelledAt と cancelledBy は必ず対で、
   * 片方だけが値を持つことはない。
   */
  cancelledAt: string | null;
  cancelledBy: string | null;
  /** 10 進の正整数の文字列。ETag / If-Match に使う版番号。 */
  version: string;
  achievement: PlanEvent | null;
  booking: PlanEvent | null;
  /**
   * 画面表示の目安（kind の変更が可能か）。書き込みの可否はサーバが
   * 改めて判定するため、表示制御以外に使わない。
   */
  canChangeKind: boolean;
  kindChangeReason: "record_history_exists" | null;
};

export type PlanCreate = {
  name: string;
  kind: PlanKind;
  /** `YYYY-MM-DD`。 */
  date: string;
  /** 日本の現地時刻 `HH:mm`。未定は省略か null。 */
  time?: string | null;
  memo?: string | null;
};

export type PlanPatch = {
  name?: string;
  kind?: PlanKind;
  /** 日本の現地時刻 `HH:mm`。未定に戻すときは null。 */
  time?: string | null;
  memo?: string | null;
};

export type Move = {
  /** `YYYY-MM-DD`。旅行の期間内の移動先の日付。 */
  date: string;
};

export type Period = {
  /** `YYYY-MM-DD`。 */
  startsOn: string;
  /** `YYYY-MM-DD`。 */
  endsOn: string;
};

export type Itinerary = {
  trip: Trip;
  /** `YYYY-MM-DD`。 */
  date: string;
  plans: Plan[];
  /** ISO 8601 の日時。 */
  fetchedAt: string;
};
