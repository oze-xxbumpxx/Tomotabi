import type { BoundedText } from "../../../../common/domain/bounded-text.js";
import type { UserId } from "../../../../common/domain/user-id.js";
import type { TodoCategory } from "../../domain/todo-category.js";

/** カテゴリの新規作成データ。id / version / created_at / updated_atはDBが埋める。 */
export type NewTodoCategory = Readonly<{
  tripId: string;
  name: BoundedText;
  position: number;
  createdBy: UserId;
}>;

/**
 * カテゴリの保存。ロックは必ず旅行行のあと（旅行 → 予定 → カテゴリ → ToDo）。
 */
export interface TodoCategoryRepository {
  /**
   * 旅行のカテゴリを二人の決めた順（position, createdAt, id）で返す。
   */
  listByTrip(tripId: string): Promise<TodoCategory[]>;

  /**
   * 旅行のカテゴリを全部FOR UPDATEでロックし、二人の決めた順で返す。
   * 追加・並べ替えで件数・順を比べるときに使う
   * （同時の追加で上限を超えない・同時の並べ替えは片方が409になる）。
   */
  lockAllForUpdate(tripId: string): Promise<TodoCategory[]>;

  /**
   * 旅行の中のカテゴリをFOR UPDATEでロックして返す。無ければnull。
   * 名前の変更・削除で使う。
   */
  lockForUpdate(
    tripId: string,
    categoryId: string,
  ): Promise<TodoCategory | null>;

  /**
   * 旅行の中のカテゴリをFOR SHAREで読む。無ければnull。
   * ToDoの追加・編集でcategoryIdを確かめるときに使う。
   */
  lockForShare(
    tripId: string,
    categoryId: string,
  ): Promise<TodoCategory | null>;

  /** カテゴリを追加して、DBが埋めた値を含めて返す。 */
  insert(category: NewTodoCategory): Promise<TodoCategory>;

  /** カテゴリ行をまるごと更新する。呼び出し前に行ロックを持っていること。 */
  update(category: TodoCategory): Promise<void>;

  /**
   * 並べ替え。orderは新しい順のカテゴリidで、positionをその添字に置き直す。
   * 呼び出し前に旅行のカテゴリを全部ロック（lockAllForUpdate）してあること。
   */
  updatePositions(tripId: string, order: readonly string[]): Promise<void>;

  /** カテゴリ行を消す。呼び出し前に行ロックを持っていること。 */
  delete(tripId: string, categoryId: string): Promise<void>;
}
