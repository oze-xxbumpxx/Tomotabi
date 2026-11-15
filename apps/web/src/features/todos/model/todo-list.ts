import type { Todo, TodoCategory } from "@tomotabi/contracts";

/**
 * ToDoのリストの振り分け・絞り込み・期限の印（設計書 todo-organize
 * 「フロントエンド設計」、要件F-03〜F-05・F-11〜F-13・B-05〜B-07）。
 * 「今日」は呼び出し側が日本の日付（`shared/lib/local-date`の`tokyoDateOf`）で渡す。
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** `YYYY-MM-DD`同士の日数差（dueOn - today）。 */
function daysUntil(dueOn: string, today: string): number {
  return Math.round(
    (Date.parse(`${dueOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) /
      DAY_MS,
  );
}

/**
 * 期限の印（F-12・B-06）。期限まで3日以内は「あとN日」、当日は「今日まで」、
 * 過ぎたら「期限切れ」。4日以上先はnull（印を出さない）。
 */
export function dueBadge(dueOn: string | null, today: string): string | null {
  if (dueOn === null) {
    return null;
  }
  const days = daysUntil(dueOn, today);
  if (days < 0) {
    return "期限切れ";
  }
  if (days === 0) {
    return "今日まで";
  }
  if (days <= 3) {
    return `あと${days}日`;
  }
  return null;
}

/** 「期限が近い」: 未完了で期限まで3日以内、または期限を過ぎている（F-12）。 */
export function isDueSoon(todo: Todo, today: string): boolean {
  return (
    todo.doneAt === null &&
    todo.dueOn !== null &&
    daysUntil(todo.dueOn, today) <= 3
  );
}

/** 行に出す期限（「10/5まで」）。 */
export function formatDueOn(dueOn: string): string {
  const [, month, day] = dueOn.split("-");
  return `${Number(month)}/${Number(day)}まで`;
}

/** 行に出す関連する予定の日付（「10/12 新幹線で京都へ」）。 */
export function formatPlanDate(date: string): string {
  const [, month, day] = date.split("-");
  return `${Number(month)}/${Number(day)}`;
}

export type TodoFilter = "all" | "mine" | "due-soon";

/** 絞り込み（F-13）。「自分の担当」はassigneeIdが自分、「期限が近い」はisDueSoon。 */
export function matchesTodoFilter(
  todo: Todo,
  filter: TodoFilter,
  userId: string | null,
  today: string,
): boolean {
  switch (filter) {
    case "all":
      return true;
    case "mine":
      return userId !== null && todo.assigneeId === userId;
    case "due-soon":
      return isDueSoon(todo, today);
  }
}

export type TodoColumn = {
  /** 未分類の欄はnull。 */
  category: TodoCategory | null;
  open: Todo[];
  done: Todo[];
};

/**
 * 一覧（追加した順）をカテゴリごとの欄に振り分ける（F-03・F-04）。
 * 欄は二人の決めた順、最後に未分類。欄の中は未完了が上・完了が下で、
 * それぞれ追加した順のまま。
 */
export function assignTodos(
  categories: TodoCategory[],
  items: Todo[],
): TodoColumn[] {
  const columns: TodoColumn[] = categories.map((category) => ({
    category,
    open: [],
    done: [],
  }));
  const uncategorized: TodoColumn = { category: null, open: [], done: [] };
  for (const item of items) {
    const column =
      item.categoryId === null
        ? uncategorized
        : (columns.find((entry) => entry.category?.id === item.categoryId) ??
          uncategorized);
    if (item.doneAt === null) {
      column.open.push(item);
    } else {
      column.done.push(item);
    }
  }
  columns.push(uncategorized);
  return columns;
}

/** 欄の見出しの件数（「1 / 3 件済み」。B-04の0件は「0 / 0 件済み」）。 */
export function columnCountText(column: TodoColumn): string {
  return `${column.done.length} / ${column.open.length + column.done.length} 件済み`;
}

/** リストの上の進み具合（「4件済み · 残り6件」）。 */
export function todoSummary(items: Todo[]): {
  done: number;
  open: number;
  text: string;
  /** 棒の進み具合（0〜1）。0件なら0。 */
  ratio: number;
} {
  const done = items.filter((item) => item.doneAt !== null).length;
  const open = items.length - done;
  return {
    done,
    open,
    text: `${done}件済み · 残り${open}件`,
    ratio: items.length === 0 ? 0 : done / items.length,
  };
}
