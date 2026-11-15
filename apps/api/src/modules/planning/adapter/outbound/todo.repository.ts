import type { BoundedText } from "../../../../common/domain/bounded-text.js";
import type { UserId } from "../../../../common/domain/user-id.js";
import type { Todo } from "../../domain/todo.js";

/** ToDoの新規作成データ。id / version / created_at / updated_atはDBが埋める。 */
export type NewTodo = Readonly<{
  tripId: string;
  name: BoundedText;
  createdBy: UserId;
  /** 入れるカテゴリ。未分類はnull。 */
  categoryId: string | null;
  /** 関連付ける予定。無ければnull。 */
  planId: string | null;
}>;

/** ToDoをつないだ予定の、画面に出す分（名前・日付・取りやめ）。 */
export type TodoPlanLink = Readonly<{
  id: string;
  name: string;
  date: string;
  cancelled: boolean;
}>;

/** ToDoと、つないだ予定（無ければnull）。 */
export type TodoView = Readonly<{
  todo: Todo;
  plan: TodoPlanLink | null;
}>;

/**
 * ToDoの保存。ロックは必ず旅行行のあと（旅行 → 予定 → ToDo）。
 */
export interface TodoRepository {
  /** 旅行のToDoの件数（完了を含む）。旅行行のロック中に呼ぶ。 */
  countByTrip(tripId: string): Promise<number>;
  /** ToDoを追加して、DBが埋めた値を含めて返す。 */
  insert(todo: NewTodo): Promise<Todo>;
  /** 旅行の中のToDoをFOR NO KEY UPDATEでロックして返す。無ければnull。 */
  lockForUpdate(tripId: string, todoId: string): Promise<Todo | null>;
  /** ToDo行をまるごと更新する。呼び出し前に行ロックを持っていること。 */
  update(todo: Todo): Promise<void>;
  /** ToDo行を消す。呼び出し前に行ロックを持っていること。 */
  delete(tripId: string, todoId: string): Promise<void>;
  /** カテゴリの中のToDoの件数（カテゴリの削除の確かめ用）。 */
  countByCategory(tripId: string, categoryId: string): Promise<number>;
  /**
   * カテゴリの中のToDoを全部消し、消えた件数を返す。
   * 呼び出し前にカテゴリ行のロックを持っていること。
   */
  deleteByCategory(tripId: string, categoryId: string): Promise<number>;
  /** 旅行の中の予定の名前・日付・取りやめ。無ければnull。 */
  planLink(tripId: string, planId: string): Promise<TodoPlanLink | null>;
}
