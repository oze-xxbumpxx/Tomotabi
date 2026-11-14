"use client";

import {
  ArrowDown,
  ArrowUp,
  CaretDown,
  CaretRight,
  Check,
  DotsThreeVertical,
  PencilSimple,
  Plus,
  Trash,
} from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import type {
  Todo,
  TodoCategory,
  TodoCategoryDeletion,
  TodoCategoryOrder,
  TodoList,
} from "@tomotabi/contracts";
import { useMe } from "@/features/auth";
import { useBalance } from "@/features/payments";
import {
  assignTodos,
  columnCountText,
  completeTodoDraft,
  CREATE_TODO_CATEGORY_OPERATION,
  CREATE_TODO_OPERATION,
  createTodoCategoryDraft,
  createTodoDraft,
  DELETE_TODO_CATEGORY_OPERATION,
  deleteTodoCategoryDraft,
  formatDueOn,
  formatPlanDate,
  invalidateTodos,
  matchesTodoFilter,
  REORDER_TODO_CATEGORIES_OPERATION,
  reopenTodoDraft,
  reorderTodoCategoriesDraft,
  replaceTodoInList,
  sendCompleteTodo,
  sendCreateTodo,
  sendCreateTodoCategory,
  sendDeleteTodoCategory,
  sendReopenTodo,
  sendReorderTodoCategories,
  sendUpdateTodoCategory,
  todoSummary,
  todosQueryKey,
  UPDATE_TODO_CATEGORY_OPERATION,
  updateTodoCategoryDraft,
  useTodos,
  useTodoSave,
  type TodoFilter,
} from "@/features/todos";
import { TripTabBar, useTrip } from "@/features/trips";
import { ApiRequestError } from "@/shared/api/api-failure";
import { usePendingRequestCheck } from "@/shared/browser/use-pending-request-check";
import { formatTripPeriod, tokyoDateOf } from "@/shared/lib/local-date";
import { takePendingToast } from "@/shared/lib/pending-toast";
import { boundedTextLength } from "@/shared/lib/text-length";
import { Sheet } from "@/shared/ui/sheet";
import { FetchFailed } from "@/shared/ui/state/fetch-failed";
import { Loading } from "@/shared/ui/state/loading";
import { NotAvailable } from "@/shared/ui/state/not-available";
import { OfflineBanner } from "@/shared/ui/state/offline-banner";
import { RefetchFailed, Refetching } from "@/shared/ui/state/refetch-failed";
import { SaveUnknown } from "@/shared/ui/state/save-unknown";
import { SessionExpired } from "@/shared/ui/state/session-expired";
import { StorageUnavailable } from "@/shared/ui/state/storage-unavailable";
import { useOnlineStatus } from "@/shared/ui/state/use-online-status";
import { StatusText } from "@/shared/ui/status-text";
import { Toast } from "@/shared/ui/toast";
import { todoActorLine } from "./todo-actor";
import {
  loadAddCategory,
  loadCollapsedSections,
  saveAddCategory,
  saveCollapsedSections,
  UNCATEGORIZED_KEY,
} from "./todo-prefs";

const NAME_MAX = 100;
const CATEGORY_NAME_MAX = 30;

type Participant = { userId: string; displayName: string };

function assigneeName(
  assigneeId: string | null,
  userId: string | null,
  participants: readonly Participant[] | undefined,
): string | null {
  if (assigneeId === null) {
    return null;
  }
  if (assigneeId === userId) {
    return "あなた";
  }
  return (
    participants?.find((p) => p.userId === assigneeId)?.displayName ?? "相手"
  );
}

/** 関連する予定の行（「10/12 新幹線で京都へ ›」）。 */
function PlanLink({ tripId, todo }: { tripId: string; todo: Todo }) {
  if (todo.plan === null) {
    return null;
  }
  return (
    <Link
      className="todo-plan-link"
      href={`/trips/${tripId}/plans/${todo.plan.id}`}
    >
      {todo.plan.cancelled
        ? "取りやめた予定 ›"
        : `${formatPlanDate(todo.plan.date)} ${todo.plan.name} ›`}
    </Link>
  );
}

function TodoRow({
  todo,
  tripId,
  disabled,
  meta,
  attrs,
  onToggle,
}: {
  todo: Todo;
  tripId: string;
  disabled: boolean;
  /** 「〇〇が追加した」「あなたが完了にした」の一行。 */
  meta: string;
  attrs?: ReactNode;
  onToggle: () => void;
}) {
  const done = todo.doneAt !== null;
  return (
    <li className={done ? "todo-row todo-row-done" : "todo-row"}>
      <button
        type="button"
        className={done ? "todo-check todo-check-done" : "todo-check"}
        aria-label={
          done
            ? `「${todo.name}」を未完了に戻す`
            : `「${todo.name}」を完了にする`
        }
        disabled={disabled}
        onClick={onToggle}
      >
        {done && <Check size={14} weight="bold" aria-hidden="true" />}
      </button>
      <div className="todo-row-main">
        <Link
          className={done ? "todo-name todo-name-done" : "todo-name"}
          href={`/trips/${tripId}/todos/${todo.id}`}
        >
          {todo.name}
        </Link>
        <span className="todo-meta">{meta}</span>
        {attrs}
      </div>
      <CaretRight size={16} aria-hidden="true" className="todo-caret" />
    </li>
  );
}

/**
 * `/trips/{tripId}/todos`のToDoのリスト（設計書 todo-organize「フロントエンド設計」、
 * 要件F-01〜F-08）。上に「4件済み · 残り6件」と進み具合の棒、絞り込み、
 * カテゴリごとの欄（二人の決めた順、最後に未分類）。追加の欄は下に置く。
 * 完了の印は押すとすぐ見た目を変え、保存できなければ戻す。
 */
export function TodosScreen({ tripId }: { tripId: string }) {
  const router = useRouter();
  const { state: meState } = useMe();
  const online = useOnlineStatus();
  const todos = useTodos(tripId);
  const trip = useTrip(tripId);
  const balance = useBalance(tripId);
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [filter, setFilter] = useState<TodoFilter>("all");
  // 欄のたたみ具合と、追加の欄で最後に選んだカテゴリ（端末に覚える）。
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [addCategory, setAddCategory] = useState<string>("");
  const [menuFor, setMenuFor] = useState<TodoCategory | null>(null);
  const [nameSheet, setNameSheet] = useState<
    "create" | TodoCategory | null
  >(null);
  const [deleteFor, setDeleteFor] = useState<TodoCategory | null>(null);
  // カテゴリの操作の画面へのお知らせ（件数が変わった・消えた）。
  const [notice, setNotice] = useState<string | null>(null);
  // シートの操作で画面全体を差し替える事態（認証切れ・旅行を開けない）。
  const [sheetFatal, setSheetFatal] = useState<
    "session-expired" | "not-available" | null
  >(null);
  // 完了の印を押した項目（保存中・保存できたあと一覧が取り直されるまで、見た目を先に変える）。
  const [toggling, setToggling] = useState<{
    id: string;
    done: boolean;
  } | null>(null);

  const userId = meState.status === "ready" ? meState.me.user.id : null;
  const createCheck = usePendingRequestCheck({
    userId,
    tripId,
    operation: CREATE_TODO_OPERATION,
  });
  const reorderCheck = usePendingRequestCheck({
    userId,
    tripId,
    operation: REORDER_TODO_CATEGORIES_OPERATION,
    url: reorderTodoCategoriesDraft(tripId, [], []).url,
  });
  const create = useTodoSave({
    tripId,
    userId,
    send: sendCreateTodo,
    check: createCheck.check,
    onSucceeded: () => setName(""),
  });
  const queryClient = useQueryClient();
  // 保存できた値で一覧の項目を先に置き換えてから、押した直後の見た目を消す
  // （取り直しを待つあいだに一度戻らないようにする）。
  const onToggled = (result: { data: Todo }) => {
    replaceTodoInList(queryClient, tripId, result.data);
    setToggling(null);
  };
  const complete = useTodoSave({
    tripId,
    userId,
    send: sendCompleteTodo,
    onSucceeded: onToggled,
  });
  const reopen = useTodoSave({
    tripId,
    userId,
    send: sendReopenTodo,
    onSucceeded: onToggled,
  });
  const reorder = useTodoSave<TodoCategoryOrder>({
    tripId,
    userId,
    send: sendReorderTodoCategories,
    check: reorderCheck.check,
    onSucceeded: (result) => {
      // 返ってきた順で一覧を先に正す（取り直しを待たない）。
      queryClient.setQueryData<TodoList>(todosQueryKey(tripId), (list) =>
        list === undefined
          ? list
          : { ...list, categories: result.data.categories },
      );
    },
  });

  useEffect(() => {
    setCollapsed(loadCollapsedSections(tripId));
    setAddCategory(loadAddCategory(tripId) ?? "");
    const pending = takePendingToast();
    if (pending !== null) {
      setToast(pending);
    }
  }, [tripId]);

  useEffect(() => {
    if (meState.status === "unauthenticated") {
      router.replace("/sign-in");
    }
  }, [meState.status, router]);

  // 完了の付け外しが保存できなかったら、見た目を元に戻す。
  const toggleSave = toggling?.done === true ? complete : reopen;
  const toggleStatus = toggleSave.state.status;
  useEffect(() => {
    if (
      toggling !== null &&
      toggleStatus !== "saving" &&
      toggleStatus !== "succeeded" &&
      toggleStatus !== "editing"
    ) {
      setToggling(null);
    }
  }, [toggling, toggleStatus]);
  // 相手が先に消したToDoだった（404）ときは、一覧を読み直す（E-04）。
  const toggleRemoved =
    toggleSave.state.status === "rejected" &&
    toggleSave.state.httpStatus === 404;
  useEffect(() => {
    if (toggleRemoved) {
      invalidateTodos(queryClient, tripId);
    }
  }, [toggleRemoved, queryClient, tripId]);

  // カテゴリが絡む拒否（消えたカテゴリに入れようとした・相手が先に並びを変えた）
  // は一覧を読み直す（E-03・E-04）。
  const createRejectedCategory =
    create.state.status === "rejected" &&
    create.state.code === "TODO_CATEGORY_NOT_FOUND";
  const reorderRejected =
    reorder.state.status === "rejected" &&
    reorder.state.code === "TODO_CATEGORY_ORDER_CHANGED";
  useEffect(() => {
    if (createRejectedCategory || reorderRejected) {
      invalidateTodos(queryClient, tripId);
    }
  }, [createRejectedCategory, reorderRejected, queryClient, tripId]);

  const failure =
    todos.error instanceof ApiRequestError ? todos.error.failure : null;
  const saves = [create.state, complete.state, reopen.state, reorder.state];
  const expired = saves.find((state) => state.status === "session-expired");
  if (
    sheetFatal === "session-expired" ||
    expired !== undefined ||
    (failure !== null && failure.kind === "http" && failure.status === 401)
  ) {
    return (
      <main>
        <SessionExpired onGoToSignIn={() => router.push("/sign-in")} />
      </main>
    );
  }
  // 旅行を開けない（403）ときだけ全面を差し替える。ToDoが無い（404）は
  // 相手が消した項目なので、リストに留まって読み直す（E-04）。
  const writeNotAvailable = saves.some(
    (state) => state.status === "rejected" && state.httpStatus === 403,
  );
  if (
    sheetFatal === "not-available" ||
    writeNotAvailable ||
    (failure !== null &&
      todos.data === undefined &&
      failure.kind === "http" &&
      (failure.status === 403 || failure.status === 404))
  ) {
    return (
      <main>
        <NotAvailable target="trip" onGoToTrips={() => router.push("/trips")} />
      </main>
    );
  }
  if (todos.isPending) {
    return (
      <main>
        <Loading />
      </main>
    );
  }
  if (todos.data === undefined) {
    return (
      <main>
        <FetchFailed onRetry={() => void todos.refetch()} />
      </main>
    );
  }

  const today = tokyoDateOf(new Date());
  const categories = todos.data.categories;
  const items = todos.data.items.map((item) =>
    toggling !== null && toggling.id === item.id
      ? withDone(item, toggling.done, userId)
      : item,
  );
  const filtered = items.filter((item) =>
    matchesTodoFilter(item, filter, userId, today),
  );
  const columns = assignTodos(categories, filtered);
  // 未分類の欄は、入っているものがあるときだけ出す。
  const shownColumns = columns.filter(
    (column) =>
      column.category !== null ||
      column.open.length + column.done.length > 0,
  );
  // 絞り込み中は当てはまるものが無い欄を出さない（B-07）。
  const visibleColumns =
    filter === "all"
      ? shownColumns
      : shownColumns.filter(
          (column) => column.open.length + column.done.length > 0,
        );
  const nothingMatched =
    filtered.length === 0 && (items.length > 0 || filter !== "all");
  const participants = balance.data?.participants;
  const actorLine = (todo: Todo) => todoActorLine(todo, userId, participants);
  const summary = todoSummary(items);
  const deleteCount = (category: TodoCategory) =>
    items.filter((item) => item.categoryId === category.id).length;

  const pendingBlocked = createCheck.check.status !== "none";
  const createLocked =
    create.state.status === "saving" || create.state.status === "unknown";
  const reorderLocked =
    reorder.state.status === "saving" || reorder.state.status === "unknown";

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === "") {
      setNameError("ToDoの内容を書いてください");
      return;
    }
    if (boundedTextLength(trimmed) > NAME_MAX) {
      setNameError(`${NAME_MAX}字までにしてください`);
      return;
    }
    setNameError(null);
    const categoryId =
      addCategory !== "" &&
      categories.some((category) => category.id === addCategory)
        ? addCategory
        : null;
    void create.submit(createTodoDraft(tripId, trimmed, categoryId));
  };

  const toggle = (todo: Todo) => {
    const nextDone = todo.doneAt === null;
    setToggling({ id: todo.id, done: nextDone });
    if (nextDone) {
      void complete.submit(completeTodoDraft(tripId, todo.id));
    } else {
      void reopen.submit(reopenTodoDraft(tripId, todo.id));
    }
  };

  const toggleCollapsed = (key: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      saveCollapsedSections(tripId, next);
      return next;
    });
  };

  const moveCategory = (category: TodoCategory, direction: -1 | 1) => {
    const ids = categories.map((entry) => entry.id);
    const index = ids.indexOf(category.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ids.length) {
      return;
    }
    const to = [...ids];
    to[index] = ids[target]!;
    to[target] = ids[index]!;
    void reorder.submit(reorderTodoCategoriesDraft(tripId, ids, to));
    setMenuFor(null);
  };

  const rejected = saves.find((state) => state.status === "rejected");
  const categoryNotice =
    notice ??
    (createRejectedCategory
      ? "このカテゴリは相手が削除しました。リストを読み直しました"
      : reorderRejected
        ? "相手が先に並びを変更しました。リストを読み直しました"
        : null);

  return (
    <main className="todo-page todo-page-list">
      {!online && <OfflineBanner at={new Date(todos.dataUpdatedAt)} />}
      {todos.isRefetchError && (
        <RefetchFailed
          fetchedAt={new Date(todos.dataUpdatedAt)}
          onRetry={() => void todos.refetch()}
        />
      )}
      {todos.isRefetching && <Refetching />}
      {createCheck.check.status === "found" && (
        <SaveUnknown
          onConfirm={() => {
            if (createCheck.check.status !== "found") {
              return;
            }
            void create
              .confirmRequest(createCheck.check.record)
              .then(createCheck.reload);
          }}
          confirming={create.state.status === "saving"}
        />
      )}
      {reorderCheck.check.status === "found" && (
        <SaveUnknown
          onConfirm={() => {
            if (reorderCheck.check.status !== "found") {
              return;
            }
            void reorder
              .confirmRequest(reorderCheck.check.record)
              .then(reorderCheck.reload);
          }}
          confirming={reorder.state.status === "saving"}
        />
      )}
      {[create, complete, reopen, reorder].map((save, index) =>
        save.state.status === "unknown" ? (
          <SaveUnknown
            key={index}
            onConfirm={() => void save.confirmWithSameRequest()}
          />
        ) : null,
      )}
      {(createCheck.check.status === "unavailable" ||
        reorderCheck.check.status === "unavailable" ||
        saves.some((state) => state.status === "storage-unavailable")) && (
        <StorageUnavailable />
      )}
      {rejected !== undefined && categoryNotice === null && (
        <StatusText tone="error">
          {rejected.status === "rejected" && rejected.httpStatus === 404
            ? "このToDoは相手が削除しました。リストを読み直しました"
            : rejected.status === "rejected" &&
                rejected.code === "TODO_LIMIT_REACHED"
              ? "ToDoは1つの旅行に200件までです。済んだものを削除してから追加してください"
              : "保存できませんでした。もう一度お試しください。"}
        </StatusText>
      )}
      {categoryNotice !== null && (
        <StatusText tone="error">{categoryNotice}</StatusText>
      )}

      <header className="todo-head">
        {trip.data !== undefined && (
          <p className="todo-trip">
            {`${trip.data.name} · ${formatTripPeriod(trip.data.startsOn, trip.data.endsOn)}`}
          </p>
        )}
        <h1 className="page-title todo-title">ToDo</h1>
        <p className="todo-lead">
          行きたい所も、出発前の用事も、ここに書きます。
        </p>
      </header>

      {items.length > 0 && (
        <div className="todo-progress">
          <p className="todo-progress-text">{summary.text}</p>
          <div
            className="todo-progress-track"
            role="progressbar"
            aria-label="ToDoの進み具合"
            aria-valuemin={0}
            aria-valuemax={items.length}
            aria-valuenow={summary.done}
          >
            <div
              className="todo-progress-bar"
              style={{ width: `${Math.round(summary.ratio * 100)}%` }}
            />
          </div>
        </div>
      )}

      {items.length > 0 && (
        <div
          className="record-filters"
          role="group"
          aria-label="ToDoの絞り込み"
        >
          {(
            [
              ["all", "すべて"],
              ["mine", "自分の担当"],
              ["due-soon", "期限が近い"],
            ] as [TodoFilter, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`record-filter${
                filter === key ? " record-filter-current" : ""
              }`}
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {items.length === 0 && categories.length === 0 ? (
        <div className="todo-empty">
          <p className="todo-empty-title">ToDoはまだありません</p>
          <p className="todo-empty-body">
            下の欄に書いて「追加する」を押すと、二人で同じリストを見られます。日付が決まったら、予定にできます。
          </p>
        </div>
      ) : nothingMatched ? (
        <p className="record-empty-text">当てはまるToDoはありません</p>
      ) : categories.length === 0 ? (
        <ul className="todo-list">
          {[
            ...filtered.filter((entry) => entry.doneAt === null),
            ...filtered.filter((entry) => entry.doneAt !== null),
          ].map((todo) => (
            <TodoRow
              key={todo.id}
              todo={todo}
              tripId={tripId}
              disabled={!online || toggling !== null}
              meta={
                todo.memo !== null
                  ? `${actorLine(todo)} · メモあり`
                  : actorLine(todo)
              }
              attrs={<TodoAttrs todo={todo} tripId={tripId} today={today} participants={participants} userId={userId} />}
              onToggle={() => toggle(todo)}
            />
          ))}
        </ul>
      ) : (
        <>
          {visibleColumns.map((column) => {
            const key = column.category?.id ?? UNCATEGORIZED_KEY;
            const label = column.category?.name ?? "未分類";
            const isCollapsed = collapsed.has(key);
            return (
              <section
                key={key}
                className="todo-section"
                aria-label={label}
              >
                <div className="todo-section-head">
                  <h2 className="todo-section-title">
                    <button
                      type="button"
                      className="todo-section-toggle"
                      aria-expanded={!isCollapsed}
                      onClick={() => toggleCollapsed(key)}
                    >
                      <CaretDown
                        size={14}
                        weight="bold"
                        aria-hidden="true"
                        className={
                          isCollapsed
                            ? "todo-section-caret todo-section-caret-closed"
                            : "todo-section-caret"
                        }
                      />
                      {label}
                      <span className="todo-section-count">
                        {columnCountText(column)}
                      </span>
                    </button>
                  </h2>
                  {column.category !== null && (
                    <button
                      type="button"
                      className="icon-button todo-section-menu"
                      aria-label={`「${column.category.name}」のメニュー`}
                      disabled={!online}
                      onClick={() => setMenuFor(column.category)}
                    >
                      <DotsThreeVertical
                        size={18}
                        weight="bold"
                        aria-hidden="true"
                      />
                    </button>
                  )}
                </div>
                {!isCollapsed && (
                  <ul className="todo-list">
                    {[...column.open, ...column.done].map((todo) => (
                      <TodoRow
                        key={todo.id}
                        todo={todo}
                        tripId={tripId}
                        disabled={!online || toggling !== null}
                        meta={
                          todo.memo !== null
                            ? `${actorLine(todo)} · メモあり`
                            : actorLine(todo)
                        }
                        attrs={
                          <TodoAttrs
                            todo={todo}
                            tripId={tripId}
                            today={today}
                            participants={participants}
                            userId={userId}
                          />
                        }
                        onToggle={() => toggle(todo)}
                      />
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </>
      )}

      <button
        type="button"
        className="btn-outline todo-category-add"
        disabled={!online}
        onClick={() => setNameSheet("create")}
      >
        <Plus size={16} weight="bold" aria-hidden="true" />
        カテゴリを追加
      </button>

      <form
        className="todo-add"
        aria-label="ToDoを追加する"
        onSubmit={submit}
        noValidate
      >
        {categories.length > 0 && (
          <>
            <label className="sr-only" htmlFor="todo-new-category">
              入れるカテゴリ
            </label>
            <select
              id="todo-new-category"
              className="field-input todo-add-category"
              value={addCategory}
              onChange={(event) => {
                setAddCategory(event.target.value);
                saveAddCategory(tripId, event.target.value);
              }}
            >
              <option value="">未分類</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </>
        )}
        <label className="sr-only" htmlFor="todo-new">
          ToDoの内容
        </label>
        <input
          id="todo-new"
          className="field-input todo-add-input"
          type="text"
          value={name}
          placeholder="行きたい所、やることを書く"
          aria-invalid={nameError !== null}
          aria-describedby={nameError !== null ? "todo-new-error" : undefined}
          data-locked={createLocked || pendingBlocked ? "true" : undefined}
          readOnly={createLocked || pendingBlocked}
          onChange={(event) => {
            setName(event.target.value);
            setNameError(null);
            if (create.state.status === "rejected") {
              create.backToEditing();
            }
          }}
        />
        <button
          type="submit"
          className="btn-ink todo-add-button"
          disabled={!online || createLocked || pendingBlocked}
        >
          {create.state.status === "saving" ? "追加中" : "追加する"}
        </button>
      </form>
      {nameError !== null && (
        <p id="todo-new-error" className="field-error todo-add-error">
          {nameError}
        </p>
      )}

      {menuFor !== null && (
        <CategoryMenuSheet
          category={menuFor}
          index={categories.findIndex(
            (entry) => entry.id === menuFor.id,
          )}
          total={categories.length}
          disabled={!online || reorderLocked}
          onClose={() => setMenuFor(null)}
          onRename={(category) => {
            setMenuFor(null);
            setNameSheet(category);
          }}
          onMove={moveCategory}
          onDelete={(category) => {
            setMenuFor(null);
            setDeleteFor(category);
          }}
        />
      )}
      {nameSheet !== null && (
        <CategoryNameSheet
          tripId={tripId}
          userId={userId}
          online={online}
          category={nameSheet === "create" ? null : nameSheet}
          onClose={() => setNameSheet(null)}
          onFatal={setSheetFatal}
          onGone={(message) => {
            setNotice(message);
            invalidateTodos(queryClient, tripId);
            setNameSheet(null);
          }}
        />
      )}
      {deleteFor !== null && (
        <CategoryDeleteSheet
          tripId={tripId}
          userId={userId}
          online={online}
          category={deleteFor}
          todoCount={deleteCount(deleteFor)}
          onClose={() => setDeleteFor(null)}
          onFatal={setSheetFatal}
          onGone={(message) => {
            setNotice(message);
            invalidateTodos(queryClient, tripId);
            setDeleteFor(null);
          }}
          onCountChanged={() => {
            setNotice(
              "ToDoの件数が変わりました。リストを読み直しました",
            );
            invalidateTodos(queryClient, tripId);
            setDeleteFor(null);
          }}
        />
      )}

      {toast !== null && (
        <Toast message={toast} onDismiss={() => setToast(null)} />
      )}
      <TripTabBar tripId={tripId} current="todos" action={null} />
    </main>
  );
}

/** 行に出すもの: 未完了なら期限（「10/5まで」）と担当、関連する予定。 */
function TodoAttrs({
  todo,
  tripId,
  today,
  participants,
  userId,
}: {
  todo: Todo;
  tripId: string;
  today: string;
  participants: readonly Participant[] | undefined;
  userId: string | null;
}) {
  const done = todo.doneAt !== null;
  const assignee = done
    ? null
    : assigneeName(todo.assigneeId, userId, participants);
  const overdue = todo.dueOn !== null && todo.dueOn < today;
  if (done) {
    return todo.plan === null ? null : (
      <span className="todo-meta">
        <PlanLink tripId={tripId} todo={todo} />
      </span>
    );
  }
  if (todo.dueOn === null && assignee === null && todo.plan === null) {
    return null;
  }
  return (
    <span className="todo-meta todo-attrs">
      {todo.dueOn !== null && (
        <span className={overdue ? "todo-attr todo-attr-over" : "todo-attr"}>
          {formatDueOn(todo.dueOn)}
        </span>
      )}
      {assignee !== null && (
        <span className="todo-attr">{`担当: ${assignee}`}</span>
      )}
      <PlanLink tripId={tripId} todo={todo} />
    </span>
  );
}

/** 欄の見出しのメニュー（名前を変更・上へ移動・下へ移動・削除）。 */
function CategoryMenuSheet({
  category,
  index,
  total,
  disabled,
  onClose,
  onRename,
  onMove,
  onDelete,
}: {
  category: TodoCategory;
  index: number;
  total: number;
  disabled: boolean;
  onClose: () => void;
  onRename: (category: TodoCategory) => void;
  onMove: (category: TodoCategory, direction: -1 | 1) => void;
  onDelete: (category: TodoCategory) => void;
}) {
  return (
    <Sheet title={category.name} onClose={onClose}>
      <div className="menu-card">
        <button
          type="button"
          className="menu-item"
          disabled={disabled}
          onClick={() => onRename(category)}
        >
          <span className="menu-item-icon" aria-hidden="true">
            <PencilSimple size={20} />
          </span>
          <span className="menu-item-main">
            <span className="menu-item-label">名前を変更</span>
          </span>
        </button>
        {index > 0 && (
          <button
            type="button"
            className="menu-item"
            disabled={disabled}
            onClick={() => onMove(category, -1)}
          >
            <span className="menu-item-icon" aria-hidden="true">
              <ArrowUp size={20} />
            </span>
            <span className="menu-item-main">
              <span className="menu-item-label">上へ移動</span>
            </span>
          </button>
        )}
        {index >= 0 && index < total - 1 && (
          <button
            type="button"
            className="menu-item"
            disabled={disabled}
            onClick={() => onMove(category, 1)}
          >
            <span className="menu-item-icon" aria-hidden="true">
              <ArrowDown size={20} />
            </span>
            <span className="menu-item-main">
              <span className="menu-item-label">下へ移動</span>
            </span>
          </button>
        )}
        <div className="menu-sep" role="separator" />
        <button
          type="button"
          className="menu-item"
          disabled={disabled}
          onClick={() => onDelete(category)}
        >
          <span className="menu-item-icon" aria-hidden="true">
            <Trash size={20} />
          </span>
          <span className="menu-item-main">
            <span className="menu-item-label">削除</span>
          </span>
        </button>
      </div>
    </Sheet>
  );
}

/** 「カテゴリを追加」「名前を変更」のシート（B-02・E-01〜E-04）。 */
function CategoryNameSheet({
  tripId,
  userId,
  online,
  category,
  onClose,
  onFatal,
  onGone,
}: {
  tripId: string;
  userId: string | null;
  online: boolean;
  /** nullなら追加、TodoCategoryなら名前の変更。 */
  category: TodoCategory | null;
  onClose: () => void;
  onFatal: (kind: "session-expired" | "not-available") => void;
  onGone: (message: string) => void;
}) {
  const isCreate = category === null;
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(category?.name ?? "");
  const [error, setError] = useState<string | null>(null);
  const operation = isCreate
    ? CREATE_TODO_CATEGORY_OPERATION
    : UPDATE_TODO_CATEGORY_OPERATION;
  const url = isCreate
    ? createTodoCategoryDraft(tripId, "").url
    : updateTodoCategoryDraft(tripId, category.id, { name: "" }, "1").url;
  const check = usePendingRequestCheck({ userId, tripId, operation, url });
  const queryClient = useQueryClient();
  const save = useTodoSave<TodoCategory>({
    tripId,
    userId,
    send: isCreate ? sendCreateTodoCategory : sendUpdateTodoCategory,
    check: check.check,
    onSucceeded: () => onClose(),
  });

  const status = save.state.status;
  const rejectedCode =
    save.state.status === "rejected" ? save.state.code : null;
  const rejectedStatus =
    save.state.status === "rejected" ? save.state.httpStatus : null;
  useEffect(() => {
    if (status === "session-expired") {
      onFatal("session-expired");
    } else if (rejectedStatus === 403 || (isCreate && rejectedStatus === 404)) {
      onFatal("not-available");
    } else if (rejectedCode === "TODO_CATEGORY_NOT_FOUND" || (!isCreate && rejectedStatus === 404)) {
      onGone("このカテゴリは相手が削除しました。リストを読み直しました");
    }
  }, [status, rejectedCode, rejectedStatus, isCreate, onFatal, onGone]);

  const saving =
    status === "saving" || status === "unknown" || check.check.status !== "none";

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === "") {
      setError("カテゴリの名前を書いてください");
      return;
    }
    if (boundedTextLength(trimmed) > CATEGORY_NAME_MAX) {
      setError(`カテゴリの名前は${CATEGORY_NAME_MAX}字までにしてください`);
      return;
    }
    if (!isCreate && trimmed === category.name) {
      onClose();
      return;
    }
    setError(null);
    void save.submit(
      isCreate
        ? createTodoCategoryDraft(tripId, trimmed)
        : updateTodoCategoryDraft(
            tripId,
            category.id,
            { name: trimmed },
            category.version,
          ),
    );
  };

  const rejectedMessage =
    rejectedCode === "TODO_CATEGORY_LIMIT_REACHED"
      ? "カテゴリは1つの旅行に20個までです"
      : rejectedCode === "VALIDATION_FAILED"
        ? `カテゴリの名前は1〜${CATEGORY_NAME_MAX}字で書いてください`
        : status === "rejected"
          ? "保存できませんでした。もう一度お試しください。"
          : null;

  return (
    <Sheet
      title={isCreate ? "カテゴリを追加" : "名前を変更"}
      onClose={onClose}
      closable={status !== "saving" && status !== "unknown"}
      initialFocus={inputRef}
      footer={
        <button
          type="submit"
          form="todo-category-form"
          className="btn-ink sheet-footer-button"
          disabled={!online || saving}
        >
          {status === "saving"
            ? "保存中"
            : isCreate
              ? "追加する"
              : "保存する"}
        </button>
      }
    >
      <form id="todo-category-form" onSubmit={submit} noValidate>
        {check.check.status === "found" && (
          <SaveUnknown
            onConfirm={() => {
              if (check.check.status !== "found") {
                return;
              }
              void save
                .confirmRequest(check.check.record)
                .then(check.reload);
            }}
            confirming={status === "saving"}
          />
        )}
        {status === "unknown" && (
          <SaveUnknown
            onConfirm={() => void save.confirmWithSameRequest()}
          />
        )}
        {(check.check.status === "unavailable" ||
          status === "storage-unavailable") && <StorageUnavailable />}
        {status === "conflict" && (
          <div className="banner banner-warning" role="alert">
            <div className="banner-text">
              <span className="banner-title">相手が先に変更しました</span>
              <span className="banner-body">
                最新の内容を読み込んでから、もう一度直してください。
              </span>
            </div>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                invalidateTodos(queryClient, tripId);
                onClose();
              }}
            >
              最新の内容を読み込む
            </button>
          </div>
        )}
        <div className="field">
          <label className="field-label" htmlFor="todo-category-name">
            名前
          </label>
          <input
            id="todo-category-name"
            ref={inputRef}
            className="field-input"
            type="text"
            value={name}
            readOnly={saving}
            data-locked={saving ? "true" : undefined}
            onChange={(event) => {
              setName(event.target.value);
              setError(null);
              if (status === "rejected") {
                save.backToEditing();
              }
            }}
          />
        </div>
        {error !== null && <p className="field-error">{error}</p>}
        {rejectedMessage !== null && error === null && (
          <StatusText tone="error">{rejectedMessage}</StatusText>
        )}
      </form>
    </Sheet>
  );
}

/** カテゴリの削除の確かめ（B-04・E-05）。中のToDoも一緒に消える。 */
function CategoryDeleteSheet({
  tripId,
  userId,
  online,
  category,
  todoCount,
  onClose,
  onFatal,
  onGone,
  onCountChanged,
}: {
  tripId: string;
  userId: string | null;
  online: boolean;
  category: TodoCategory;
  /** 確かめるために見せた、いま中に入っているToDoの件数。 */
  todoCount: number;
  onClose: () => void;
  onFatal: (kind: "session-expired" | "not-available") => void;
  onGone: (message: string) => void;
  /** 送った件数が合わなかった（409 TODO_COUNT_CHANGED）。 */
  onCountChanged: () => void;
}) {
  const url = deleteTodoCategoryDraft(tripId, category.id, 0).url;
  const check = usePendingRequestCheck({
    userId,
    tripId,
    operation: DELETE_TODO_CATEGORY_OPERATION,
    url,
  });
  const save = useTodoSave<TodoCategoryDeletion>({
    tripId,
    userId,
    send: sendDeleteTodoCategory,
    check: check.check,
    onSucceeded: () => onClose(),
  });

  const status = save.state.status;
  const rejectedCode =
    save.state.status === "rejected" ? save.state.code : null;
  const rejectedStatus =
    save.state.status === "rejected" ? save.state.httpStatus : null;
  useEffect(() => {
    if (status === "session-expired") {
      onFatal("session-expired");
    } else if (rejectedStatus === 403) {
      onFatal("not-available");
    } else if (rejectedCode === "TODO_COUNT_CHANGED") {
      onCountChanged();
    } else if (
      rejectedCode === "TODO_CATEGORY_NOT_FOUND" ||
      rejectedStatus === 404
    ) {
      onGone("このカテゴリは相手が削除しました。リストを読み直しました");
    }
  }, [status, rejectedCode, rejectedStatus, onFatal, onGone, onCountChanged]);

  const saving =
    status === "saving" || status === "unknown" || check.check.status !== "none";

  return (
    <Sheet
      title="カテゴリを削除"
      onClose={onClose}
      closable={status !== "saving" && status !== "unknown"}
      footer={
        <div className="dialog-actions">
          <button
            type="button"
            className="btn-secondary"
            disabled={status === "saving"}
            onClick={onClose}
          >
            やめる
          </button>
          <button
            type="button"
            className="btn-danger"
            disabled={!online || saving}
            onClick={() =>
              void save.submit(
                deleteTodoCategoryDraft(tripId, category.id, todoCount),
              )
            }
          >
            {status === "saving" ? "削除中" : "削除する"}
          </button>
        </div>
      }
    >
      {check.check.status === "found" && (
        <SaveUnknown
          onConfirm={() => {
            if (check.check.status !== "found") {
              return;
            }
            void save.confirmRequest(check.check.record).then(check.reload);
          }}
          confirming={status === "saving"}
        />
      )}
      {status === "unknown" && (
        <SaveUnknown onConfirm={() => void save.confirmWithSameRequest()} />
      )}
      {(check.check.status === "unavailable" ||
        status === "storage-unavailable") && <StorageUnavailable />}
      <p className="sheet-lead">
        {`「${category.name}」を削除します。`}
        {todoCount > 0
          ? `ToDo ${todoCount}件も削除されます。`
          : "このカテゴリにToDoはありません。"}
        元に戻せません。
      </p>
      {status === "rejected" && (
        <StatusText tone="error">
          保存できませんでした。もう一度お試しください。
        </StatusText>
      )}
    </Sheet>
  );
}

/**
 * 完了の印を押した直後の見た目。完了者は押した本人にしておく。
 * つないだ予定は消さない（完了の付け外しとは別の関連付け。F-17）。
 */
function withDone(todo: Todo, done: boolean, userId: string | null): Todo {
  if (done) {
    return todo.doneAt !== null
      ? todo
      : { ...todo, doneAt: new Date().toISOString(), doneBy: userId };
  }
  return { ...todo, doneAt: null, doneBy: null };
}
