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

/** ToDoを分けるカテゴリ。一覧で`categories`として返す。 */
export type TodoCategory = {
  id: string;
  tripId: string;
  name: string;
  /** 10進の正整数の文字列。名前の変更の`X-Expected-Version`にそのまま送る版番号。 */
  version: string;
};

/** ToDoを予定にしたときの、つないだ予定。 */
export type TodoPlan = {
  id: string;
  /** 予定の名前。 */
  name: string;
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
  /**
   * つないだ予定。予定への関連付けは完了の付け外しとは別なので、
   * 完了の印を外してもそのまま。
   */
  plan: TodoPlan | null;
  /** 入っているカテゴリ。未分類はnull。 */
  categoryId: string | null;
  /** 担当の参加者。未定はnull。 */
  assigneeId: string | null;
  /** `YYYY-MM-DD`。期限。無ければnull。 */
  dueOn: string | null;
  /** 10進の正整数の文字列。編集の`X-Expected-Version`にそのまま送る版番号。 */
  version: string;
};

/**
 * categoriesは二人の決めた順、itemsは追加した順。
 * 未完了・完了の並べ替えとカテゴリごとの振り分けは画面でする。
 */
export type TodoList = {
  categories: TodoCategory[];
  items: Todo[];
};

export type TodoCreate = {
  name: string;
  /** 入れるカテゴリ。未分類はnull・省略。 */
  categoryId?: string | null;
};

export type TodoPatch = {
  name?: string;
  /** 消すときはnull。 */
  memo?: string | null;
  /** 移す・未分類に戻すときはnull。 */
  categoryId?: string | null;
  /** 担当を変える・未定に戻すときはnull。 */
  assigneeId?: string | null;
  /** `YYYY-MM-DD`。期限を消すときはnull。 */
  dueOn?: string | null;
};

/** カテゴリの追加。 */
export type TodoCategoryCreate = {
  name: string;
};

/** カテゴリの名前の変更。 */
export type TodoCategoryPatch = {
  name: string;
};

/** カテゴリの並べ替えの入力。`to`は`from`の並べ替え。 */
export type TodoCategoryReorder = {
  from: string[];
  to: string[];
};

/** カテゴリの並べ替えの結果（並べ替えたあとの順）。 */
export type TodoCategoryOrder = {
  categories: TodoCategory[];
};

/** カテゴリの削除の結果。中のToDoも消える。 */
export type TodoCategoryDeletion = {
  id: string;
  /** カテゴリと一緒に消えたToDoの件数。 */
  deletedTodoCount: number;
};

/** 削除の結果。同じキーの再送は、行が無くても同じ本文を返す。 */
export type TodoDeletion = {
  id: string;
};
