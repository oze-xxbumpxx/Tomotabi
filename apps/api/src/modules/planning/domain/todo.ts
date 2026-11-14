import type { BoundedText } from "../../../common/domain/bounded-text.js";
import type { LocalDate } from "../../../common/domain/local-date.js";
import type { UserId } from "../../../common/domain/user-id.js";

/**
 * 旅行のToDoの1件（設計書 trip-todo「DB 設計」+ todo-organize）。
 * doneAtとdoneByは必ず対。planIdは関連付けで入り、
 * 完了かどうかに関係なく持つ（todo-organizeのF-18で完了の付け外しから分離）。
 * 「予定にする」でも完了にはならず、関連付けだけが入る（todo-organize F-19）。
 */
export type Todo = Readonly<{
  id: string;
  tripId: string;
  name: BoundedText;
  memo: BoundedText | null;
  createdBy: UserId;
  createdAt: Date;
  doneAt: Date | null;
  doneBy: UserId | null;
  planId: string | null;
  /** 入っているカテゴリ。未分類はnull。 */
  categoryId: string | null;
  /** 担当（旅行の参加者）。未定はnull。 */
  assigneeId: UserId | null;
  /** 期限。無ければnull。 */
  dueOn: LocalDate | null;
  version: number;
  updatedAt: Date;
}>;

/**
 * 部分更新の入力。キーがある欄だけが対象。undefinedは「送られていない」、
 * nullは「消す」（設計書 todo-organize「API 設計」）。
 */
export type TodoPatch = Readonly<{
  name?: BoundedText;
  memo?: BoundedText | null;
  categoryId?: string | null;
  assigneeId?: UserId | null;
  dueOn?: LocalDate | null;
  /** 関連付ける予定。nullは関連付けを外す。 */
  planId?: string | null;
}>;

export const Todo = {
  /** 名前・メモ・カテゴリ・担当・期限を変える。差分が無ければ同じTodoを返す（versionは増やさない）。 */
  update(todo: Todo, patch: TodoPatch, at: Date): Todo {
    const changes: {
      -readonly [K in
        | "name"
        | "memo"
        | "categoryId"
        | "assigneeId"
        | "dueOn"
        | "planId"]?: Todo[K];
    } = {};
    if (patch.name !== undefined && patch.name !== todo.name) {
      changes.name = patch.name;
    }
    if (patch.memo !== undefined && patch.memo !== todo.memo) {
      changes.memo = patch.memo;
    }
    if (
      patch.categoryId !== undefined &&
      patch.categoryId !== todo.categoryId
    ) {
      changes.categoryId = patch.categoryId;
    }
    if (
      patch.assigneeId !== undefined &&
      patch.assigneeId !== todo.assigneeId
    ) {
      changes.assigneeId = patch.assigneeId;
    }
    if (patch.dueOn !== undefined && patch.dueOn !== todo.dueOn) {
      changes.dueOn = patch.dueOn;
    }
    if (patch.planId !== undefined && patch.planId !== todo.planId) {
      changes.planId = patch.planId;
    }
    if (Object.keys(changes).length === 0) {
      return todo;
    }
    return { ...todo, ...changes, version: todo.version + 1, updatedAt: at };
  },

  /**
   * 完了にする。完了済みなら同じTodoを返し、完了にした人・時刻は最初のまま。
   * 予定とのつながりは変えない（関連付けはlinkPlanかplanIdのパッチで入れる。
   * todo-organize F-18・F-19）。
   */
  complete(todo: Todo, by: UserId, at: Date): Todo {
    if (todo.doneAt !== null) {
      return todo;
    }
    return {
      ...todo,
      doneAt: at,
      doneBy: by,
      version: todo.version + 1,
      updatedAt: at,
    };
  },

  /**
   * 未完了に戻す。完了の人・時刻は消えるが、予定とのつながりは残す
   * （todo-organize F-18）。未完了なら同じTodoを返す。
   */
  reopen(todo: Todo, at: Date): Todo {
    if (todo.doneAt === null) {
      return todo;
    }
    return {
      ...todo,
      doneAt: null,
      doneBy: null,
      version: todo.version + 1,
      updatedAt: at,
    };
  },

  /**
   * 予定と結ぶ（関連付け。完了かどうかは変えない）。
   * 同じ予定なら同じTodoを返す。
   */
  linkPlan(todo: Todo, planId: string, at: Date): Todo {
    if (todo.planId === planId) {
      return todo;
    }
    return {
      ...todo,
      planId,
      version: todo.version + 1,
      updatedAt: at,
    };
  },
};
