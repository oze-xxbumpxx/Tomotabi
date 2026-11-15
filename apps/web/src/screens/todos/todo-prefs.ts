/**
 * ToDoのリストが端末に覚えるもの（要件F-07・F-08）。
 * 欄のたたみ具合と、追加の欄で最後に選んだカテゴリを、旅行ごとに
 * localStorageへ残す。読めない・書けないときは覚えない
 * （プライベートモード等で黙って動かし続ける）。
 */

const COLLAPSED_PREFIX = "tomotabi:todos-collapsed:";
const ADD_CATEGORY_PREFIX = "tomotabi:todos-add-category:";

/** 未分類の欄の、たたみ具合を覚えるキー。 */
export const UNCATEGORIZED_KEY = "uncategorized";

function storage(): Storage | null {
  try {
    if (typeof window === "undefined") {
      return null;
    }
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadCollapsedSections(tripId: string): ReadonlySet<string> {
  const store = storage();
  if (store === null) {
    return new Set();
  }
  try {
    const raw = store.getItem(`${COLLAPSED_PREFIX}${tripId}`);
    if (raw === null) {
      return new Set();
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return new Set();
    }
    return new Set(
      parsed.filter((value): value is string => typeof value === "string"),
    );
  } catch {
    return new Set();
  }
}

export function saveCollapsedSections(
  tripId: string,
  collapsed: ReadonlySet<string>,
): void {
  const store = storage();
  if (store === null) {
    return;
  }
  try {
    store.setItem(
      `${COLLAPSED_PREFIX}${tripId}`,
      JSON.stringify([...collapsed]),
    );
  } catch {
    // 覚えられなくても画面の動きは変えない。
  }
}

/**
 * 追加の欄で最後に選んだカテゴリ（selectの値: ""が未分類）。
 * まだ選んでいなければnull。
 */
export function loadAddCategory(tripId: string): string | null {
  const store = storage();
  if (store === null) {
    return null;
  }
  try {
    return store.getItem(`${ADD_CATEGORY_PREFIX}${tripId}`);
  } catch {
    return null;
  }
}

export function saveAddCategory(tripId: string, value: string): void {
  const store = storage();
  if (store === null) {
    return;
  }
  try {
    store.setItem(`${ADD_CATEGORY_PREFIX}${tripId}`, value);
  } catch {
    // 覚えられなくても画面の動きは変えない。
  }
}
