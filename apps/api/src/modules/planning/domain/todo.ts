import type { BoundedText } from "../../../common/domain/bounded-text.js";
import type { UserId } from "../../../common/domain/user-id.js";

/**
 * 旅行のToDoの1件（設計書 trip-todo「DB 設計」）。
 * doneAtとdoneByは必ず対。planIdは「予定にする」で完了にしたときだけ値を持ち、
 * 値があるならdoneAtもある。
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
  version: number;
  updatedAt: Date;
}>;

/** 部分更新の入力。キーがある欄だけが対象。undefinedは「送られていない」。 */
export type TodoPatch = Readonly<{
  name?: BoundedText;
  memo?: BoundedText | null;
}>;

export const Todo = {
  /** 名前・メモを変える。差分が無ければ同じTodoを返す（versionは増やさない）。 */
  update(todo: Todo, patch: TodoPatch, at: Date): Todo {
    const changes: { -readonly [K in "name" | "memo"]?: Todo[K] } = {};
    if (patch.name !== undefined && patch.name !== todo.name) {
      changes.name = patch.name;
    }
    if (patch.memo !== undefined && patch.memo !== todo.memo) {
      changes.memo = patch.memo;
    }
    if (Object.keys(changes).length === 0) {
      return todo;
    }
    return { ...todo, ...changes, version: todo.version + 1, updatedAt: at };
  },

  /**
   * 完了にする。完了済みなら同じTodoを返し、完了にした人・時刻・予定は最初のまま。
   * @param planId「予定にする」でつなぐ予定。完了の印だけならnull。
   */
  complete(todo: Todo, by: UserId, at: Date, planId: string | null): Todo {
    if (todo.doneAt !== null) {
      return todo;
    }
    return {
      ...todo,
      doneAt: at,
      doneBy: by,
      planId,
      version: todo.version + 1,
      updatedAt: at,
    };
  },

  /** 未完了に戻す。予定とのつながりも消す。未完了なら同じTodoを返す。 */
  reopen(todo: Todo, at: Date): Todo {
    if (todo.doneAt === null) {
      return todo;
    }
    return {
      ...todo,
      doneAt: null,
      doneBy: null,
      planId: null,
      version: todo.version + 1,
      updatedAt: at,
    };
  },
};
