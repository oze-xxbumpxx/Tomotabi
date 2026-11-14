import { BoundedText } from "../../../common/domain/bounded-text.js";
import type { UserId } from "../../../common/domain/user-id.js";

/** カテゴリの名前の規則（1〜30コードポイント・前後空白の除去。B-02）。 */
export const TODO_CATEGORY_NAME_MAX = 30;

/**
 * 旅行のToDoを分ける欄（設計書 todo-organize「DB 設計」）。
 * positionは二人が決めた順。同じ値を許し、(position, createdAt, id)で並べる。
 */
export type TodoCategory = Readonly<{
  id: string;
  tripId: string;
  name: BoundedText;
  position: number;
  createdBy: UserId;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}>;

export const TodoCategory = {
  /** 名前を変える。同じ名前なら同じカテゴリを返す（versionは増やさない）。 */
  rename(category: TodoCategory, name: BoundedText, at: Date): TodoCategory {
    if (name === category.name) {
      return category;
    }
    return { ...category, name, version: category.version + 1, updatedAt: at };
  },
};
