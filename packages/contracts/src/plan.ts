import type { Trip } from "./trip";

export type PlanKind = "place" | "food" | "shopping" | "lodging" | "transport";

export type EventKind = "achievement" | "booking";

export type Cancellation = {
  targetId: string;
  cancelledBy: string;
  /** ISO 8601の日時。 */
  createdAt: string;
};

export type PlanEvent = {
  id: string;
  tripId: string;
  planId: string;
  kind: EventKind;
  createdBy: string;
  /** ISO 8601の日時。 */
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
   * 日本の現地時刻`HH:mm`。時刻未定はnullで、`00:00`（0時ちょうどの
   * 確定した時刻）とは区別する。
   */
  time: string | null;
  memo: string | null;
  /**
   * 取りやめ日時（ISO 8601）。cancelledAtとcancelledByは必ず対で、
   * 片方だけが値を持つことはない。
   */
  cancelledAt: string | null;
  cancelledBy: string | null;
  /** 10進の正整数の文字列。書き込みの`X-Expected-Version`にそのまま送る版番号。 */
  version: string;
  achievement: PlanEvent | null;
  booking: PlanEvent | null;
  /**
   * 画面表示の目安（kindの変更が可能か）。書き込みの可否はサーバが
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
  /** 日本の現地時刻`HH:mm`。未定は省略かnull。 */
  time?: string | null;
  memo?: string | null;
  /**
   * 「予定にする」で元にしたToDoのID。予定の保存と同じトランザクションで
   * そのToDoを完了にして予定とつなぐ。見つからない・完了済みなら何もしない。
   */
  fromTodoId?: string | null;
};

export type PlanPatch = {
  name?: string;
  kind?: PlanKind;
  /** 日本の現地時刻`HH:mm`。未定に戻すときはnull。 */
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
  /** ISO 8601の日時。 */
  fetchedAt: string;
};

/** ToDoを予定にしたときの、つないだ予定。 */
export type TodoPlan = {
  id: string;
  /** `YYYY-MM-DD`。予定の日付。 */
  date: string;
  /** 予定を取りやめていればtrue。ToDoは完了のまま。 */
  cancelled: boolean;
};

export type Todo = {
  id: string;
  tripId: string;
  name: string;
  memo: string | null;
  createdBy: string;
  /** ISO 8601の日時。 */
  createdAt: string;
  /** 完了した日時（ISO 8601）と人。doneAtとdoneByは必ず対。 */
  doneAt: string | null;
  doneBy: string | null;
  /** 「予定にする」でつないだ予定。完了の印を外すとnullに戻る。 */
  plan: TodoPlan | null;
  /** 10進の正整数の文字列。編集の`X-Expected-Version`にそのまま送る版番号。 */
  version: string;
};

/** 未完了 → 完了の順、それぞれ追加した順。 */
export type TodoList = {
  items: Todo[];
};

export type TodoCreate = {
  name: string;
};

export type TodoPatch = {
  name?: string;
  /** 消すときはnull。 */
  memo?: string | null;
};

/** 削除の結果。同じキーの再送は、行が無くても同じ本文を返す。 */
export type TodoDeletion = {
  id: string;
};
