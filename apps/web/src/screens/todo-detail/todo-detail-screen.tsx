"use client";

import {
  CalendarPlus,
  CaretLeft,
  CaretRight,
  Check,
  CheckCircle,
  ArrowCounterClockwise,
  Trash,
} from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import type { Todo, TodoPatch } from "@tomotabi/contracts";
import { useMe } from "@/features/auth";
import { useBalance } from "@/features/payments";
import {
  completeTodoDraft,
  DELETE_TODO_OPERATION,
  deleteTodoDraft,
  dueBadge,
  formatDueOn,
  invalidateTodos,
  reopenTodoDraft,
  replaceTodoInList,
  sendCompleteTodo,
  sendDeleteTodo,
  sendReopenTodo,
  sendUpdateTodo,
  UPDATE_TODO_OPERATION,
  updateTodoDraft,
  useTodos,
  useTodoSave,
} from "@/features/todos";
import { TripTabBar } from "@/features/trips";
import { ApiRequestError } from "@/shared/api/api-failure";
import { usePendingRequestCheck } from "@/shared/browser/use-pending-request-check";
import { formatLocalDate, tokyoDateOf } from "@/shared/lib/local-date";
import { setPendingToast } from "@/shared/lib/pending-toast";
import { boundedTextLength } from "@/shared/lib/text-length";
import { Dialog } from "@/shared/ui/dialog";
import { Sheet } from "@/shared/ui/sheet";
import { FetchFailed } from "@/shared/ui/state/fetch-failed";
import { Loading } from "@/shared/ui/state/loading";
import { NotAvailable } from "@/shared/ui/state/not-available";
import { OfflineBanner } from "@/shared/ui/state/offline-banner";
import { SaveUnknown } from "@/shared/ui/state/save-unknown";
import { SessionExpired } from "@/shared/ui/state/session-expired";
import { StorageUnavailable } from "@/shared/ui/state/storage-unavailable";
import { useOnlineStatus } from "@/shared/ui/state/use-online-status";
import { StatusText } from "@/shared/ui/status-text";
import { Toast } from "@/shared/ui/toast";
import { todoActorLine } from "../todos/todo-actor";

const NAME_MAX = 100;
const MEMO_MAX = 2000;

/** 「カテゴリ・担当・期限」のどの欄を編集するシートを出しているか。 */
type FieldSheet = "category" | "assignee" | "due";

/**
 * `/trips/{tripId}/todos/{todoId}`のToDoの詳細（Claude Designの見本「ToDoの詳細」）。
 * 名前とメモは「変更を保存」で版つきで送る。完了の付け外しと削除は版を送らない。
 * 未完了なら主ボタンを「予定にする」に差し替え、名前とメモを入れた予定の追加を開く。
 */
export function TodoDetailScreen({
  tripId,
  todoId,
}: {
  tripId: string;
  todoId: string;
}) {
  const router = useRouter();
  const { state: meState } = useMe();
  const online = useOnlineStatus();
  const todos = useTodos(tripId);
  const balance = useBalance(tripId);
  const noteId = useId();
  const [name, setName] = useState<string | null>(null);
  const [memo, setMemo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [fieldSheet, setFieldSheet] = useState<FieldSheet | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // 打ち始めたときの名前・メモ。保存の前に今の値と比べ、相手が先に直していたら
  // 送らずに知らせる。版で比べないのは、完了の付け外しでも版が上がり、
  // 相手が印を押しただけで止まってしまうため。
  const [base, setBase] = useState<TodoContent | null>(null);
  const [staleBase, setStaleBase] = useState(false);

  const userId = meState.status === "ready" ? meState.me.user.id : null;
  const listHref = `/trips/${tripId}/todos`;
  const deleteUrl = deleteTodoDraft(tripId, todoId).url;
  // 変更の保留はこのToDoの経路だけを対象にする（同じ旅行の別のToDoの
  // 変更の保留を、この詳細の「保存されたか確認できません」に出さない）。
  const updateUrl = updateTodoDraft(tripId, todoId, {}, "1").url;

  const updateCheck = usePendingRequestCheck({
    userId,
    tripId,
    operation: UPDATE_TODO_OPERATION,
    url: updateUrl,
  });
  const deleteCheck = usePendingRequestCheck({
    userId,
    tripId,
    operation: DELETE_TODO_OPERATION,
    url: deleteUrl,
  });
  const queryClient = useQueryClient();
  // 保存できた値で一覧の項目を先に置き換える（取り直しまで古い値が出ないように）。
  const applySaved = (result: { data: Todo }) =>
    replaceTodoInList(queryClient, tripId, result.data);
  const update = useTodoSave({
    tripId,
    userId,
    send: sendUpdateTodo,
    check: updateCheck.check,
    onSucceeded: (result) => {
      applySaved(result);
      setName(null);
      setMemo(null);
      setBase(null);
      setToast("変更しました");
    },
  });
  // カテゴリ・担当・期限は、行で選んだらすぐ保存する。名前・メモの
  // 「変更を保存」の編集中の入力を消さないよう、別の保存状態にする。
  const updateFields = useTodoSave({
    tripId,
    userId,
    send: sendUpdateTodo,
    check: updateCheck.check,
    onSucceeded: applySaved,
  });
  const complete = useTodoSave({
    tripId,
    userId,
    send: sendCompleteTodo,
    onSucceeded: applySaved,
  });
  const reopen = useTodoSave({
    tripId,
    userId,
    send: sendReopenTodo,
    onSucceeded: applySaved,
  });
  const remove = useTodoSave({
    tripId,
    userId,
    send: sendDeleteTodo,
    check: deleteCheck.check,
    onSucceeded: () => {
      setPendingToast("削除しました");
      router.replace(listHref);
    },
  });

  useEffect(() => {
    if (meState.status === "unauthenticated") {
      router.replace("/sign-in");
    }
  }, [meState.status, router]);

  // 行からすぐ保存したものが保存できたら、選ぶシートを閉じて次を選べるようにする。
  const fieldsSucceeded = updateFields.state.status === "succeeded";
  useEffect(() => {
    if (fieldsSucceeded) {
      setFieldSheet(null);
      updateFields.backToEditing();
    }
  }, [fieldsSucceeded, updateFields]);

  // カテゴリ・担当が参照先ごと無くなっていた（422）は一覧を読み直す（E-04）。
  const fieldsRejectedGone =
    updateFields.state.status === "rejected" &&
    (updateFields.state.code === "TODO_CATEGORY_NOT_FOUND" ||
      updateFields.state.code === "TODO_ASSIGNEE_NOT_PARTICIPANT");
  useEffect(() => {
    if (fieldsRejectedGone) {
      invalidateTodos(queryClient, tripId);
    }
  }, [fieldsRejectedGone, queryClient, tripId]);

  const failure =
    todos.error instanceof ApiRequestError ? todos.error.failure : null;
  const saves = [
    update.state,
    updateFields.state,
    complete.state,
    reopen.state,
    remove.state,
  ];
  if (
    saves.some((state) => state.status === "session-expired") ||
    (failure !== null && failure.kind === "http" && failure.status === 401)
  ) {
    return (
      <main>
        <SessionExpired onGoToSignIn={() => router.push("/sign-in")} />
      </main>
    );
  }
  const backToList = {
    label: "ToDoに戻る",
    onClick: () => router.push(listHref),
  };
  const tripRejected =
    saves.some(
      (state) => state.status === "rejected" && state.httpStatus === 403,
    ) ||
    (failure !== null &&
      todos.data === undefined &&
      failure.kind === "http" &&
      (failure.status === 403 || failure.status === 404));
  if (tripRejected) {
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
  const todo = todos.data.items.find((item) => item.id === todoId);
  // 相手が先に消した（一覧に無い・書き込みが404）ときは、項目が開けない表示にする（E-04）。
  const removedByOther = saves.some(
    (state) => state.status === "rejected" && state.httpStatus === 404,
  );
  if (todo === undefined || removedByOther) {
    if (
      remove.state.status === "succeeded" ||
      remove.state.status === "saving"
    ) {
      return (
        <main>
          <Loading />
        </main>
      );
    }
    return (
      <main>
        <NotAvailable
          target="item"
          onGoToTrips={() => router.push("/trips")}
          onGoToParent={backToList}
        />
      </main>
    );
  }

  const startEditing = () => {
    if (base === null) {
      setBase({ name: todo.name, memo: todo.memo });
    }
  };
  const shownName = name ?? todo.name;
  const shownMemo = memo ?? todo.memo ?? "";
  const dirty = shownName !== todo.name || shownMemo !== (todo.memo ?? "");
  const updateLocked =
    update.state.status === "saving" ||
    update.state.status === "unknown" ||
    updateCheck.check.status !== "none";
  // 行からすぐ保存する操作も、保留の照合中・保存中は押せない（E-11）。
  const fieldsLocked =
    updateFields.state.status === "saving" ||
    updateFields.state.status === "unknown" ||
    updateCheck.check.status !== "none";
  const toggleSaving =
    complete.state.status === "saving" || reopen.state.status === "saving";

  const save = () => {
    const trimmed = shownName.trim();
    if (trimmed === "") {
      setError("内容を書いてください");
      return;
    }
    if (boundedTextLength(trimmed) > NAME_MAX) {
      setError(`内容は${NAME_MAX}字までにしてください`);
      return;
    }
    if (boundedTextLength(shownMemo) > MEMO_MAX) {
      setError(`メモは${MEMO_MAX}字までにしてください`);
      return;
    }
    setError(null);
    if (base !== null && (base.name !== todo.name || base.memo !== todo.memo)) {
      setStaleBase(true);
      return;
    }
    const patch = patchOf(todo, trimmed, shownMemo);
    if (Object.keys(patch).length === 0) {
      return;
    }
    void update.submit(updateTodoDraft(tripId, todoId, patch, todo.version));
  };

  const participants = balance.data?.participants;
  const isDone = todo.doneAt !== null;
  const today = tokyoDateOf(new Date());
  const badge = dueBadge(todo.dueOn, today);
  const categoryLabel =
    todos.data.categories.find((entry) => entry.id === todo.categoryId)
      ?.name ?? "未分類";
  const assigneeLabel =
    todo.assigneeId === null
      ? "未定"
      : todo.assigneeId === userId
        ? "あなた"
        : (participants?.find((p) => p.userId === todo.assigneeId)
            ?.displayName ?? "相手");
  const fieldsBusy =
    updateFields.state.status === "saving" ||
    updateFields.state.status === "unknown";
  const patchFields = (patch: TodoPatch) => {
    void updateFields.submit(
      updateTodoDraft(tripId, todoId, patch, todo.version),
    );
  };
  const mainAction = isDone
    ? null
    : {
        label: "予定にする",
        icon: <CalendarPlus size={20} weight="fill" aria-hidden="true" />,
        onPress: () =>
          router.push(`/trips/${tripId}/plans/new?fromTodo=${todoId}`),
        disabled: !online || dirty,
        describedBy: noteId,
      };

  const conflict =
    update.state.status === "conflict" ||
    updateFields.state.status === "conflict" ||
    staleBase;
  const goneNotice =
    updateFields.state.status === "rejected" &&
    updateFields.state.code === "TODO_CATEGORY_NOT_FOUND"
      ? "このカテゴリは相手が削除しました。リストを読み直しました"
      : updateFields.state.status === "rejected" &&
          updateFields.state.code === "TODO_ASSIGNEE_NOT_PARTICIPANT"
        ? "担当に選んだ人はもう旅行にいません。リストを読み直しました"
        : null;
  const rejected = saves.find(
    (state) =>
      state.status === "rejected" &&
      state.httpStatus !== 404 &&
      !(state === updateFields.state && fieldsRejectedGone),
  );

  return (
    <main className="todo-page">
      {!online && <OfflineBanner at={new Date(todos.dataUpdatedAt)} />}
      {[update, updateFields, complete, reopen, remove].map((s, index) =>
        s.state.status === "unknown" ? (
          <SaveUnknown
            key={index}
            onConfirm={() => void s.confirmWithSameRequest()}
          />
        ) : null,
      )}
      {updateCheck.check.status === "found" && (
        <SaveUnknown
          onConfirm={() => {
            if (updateCheck.check.status !== "found") {
              return;
            }
            void update
              .confirmRequest(updateCheck.check.record)
              .then(updateCheck.reload);
          }}
          confirming={update.state.status === "saving"}
        />
      )}
      {deleteCheck.check.status === "found" && (
        <SaveUnknown
          onConfirm={() => {
            if (deleteCheck.check.status !== "found") {
              return;
            }
            void remove
              .confirmRequest(deleteCheck.check.record)
              .then(deleteCheck.reload);
          }}
          confirming={remove.state.status === "saving"}
        />
      )}
      {(updateCheck.check.status === "unavailable" ||
        deleteCheck.check.status === "unavailable" ||
        saves.some((state) => state.status === "storage-unavailable")) && (
        <StorageUnavailable />
      )}
      {conflict && (
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
              update.backToEditing();
              setName(null);
              setMemo(null);
              setBase(null);
              setStaleBase(false);
              void todos.refetch();
            }}
          >
            最新の内容を読み込む
          </button>
        </div>
      )}
      {rejected !== undefined && !conflict && goneNotice === null && (
        <StatusText tone="error">
          保存できませんでした。もう一度お試しください。
        </StatusText>
      )}
      {goneNotice !== null && (
        <StatusText tone="error">{goneNotice}</StatusText>
      )}

      <header className="plan-detail-header">
        <Link className="plan-back" href={listHref}>
          <CaretLeft size={18} weight="bold" aria-hidden="true" />
          ToDo
        </Link>
      </header>

      <div className="todo-detail">
        <p className="todo-detail-status">
          <span
            className={isDone ? "todo-badge todo-badge-done" : "todo-badge"}
          >
            {isDone ? "済んだ" : "まだ"}
          </span>
          <span className="todo-meta">
            {`${todoActorLine({ ...todo, doneAt: null }, userId, participants)} · ${formatLocalDate(tokyoDateOf(new Date(todo.createdAt)))}`}
          </span>
        </p>
        {isDone && (
          <p className="todo-meta">
            {todoActorLine(todo, userId, participants)}
            {todo.plan !== null && (
              <>
                {" · "}
                <Link
                  className="todo-plan-link"
                  href={`/trips/${tripId}/plans/${todo.plan.id}`}
                >
                  {todo.plan.cancelled
                    ? "取りやめた予定 ›"
                    : `${formatLocalDate(todo.plan.date)} の予定 ›`}
                </Link>
              </>
            )}
          </p>
        )}

        <div className="field">
          <label className="field-label" htmlFor="todo-name">
            内容
          </label>
          <input
            id="todo-name"
            className="field-input"
            type="text"
            value={shownName}
            readOnly={updateLocked}
            data-locked={updateLocked ? "true" : undefined}
            onChange={(event) => {
              startEditing();
              setName(event.target.value);
              setError(null);
            }}
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="todo-memo">
            メモ <span className="field-optional">（なくてもよい）</span>
          </label>
          <textarea
            id="todo-memo"
            className="field-textarea"
            rows={4}
            value={shownMemo}
            readOnly={updateLocked}
            data-locked={updateLocked ? "true" : undefined}
            onChange={(event) => {
              startEditing();
              setMemo(event.target.value);
              setError(null);
            }}
          />
        </div>
        {error !== null && <p className="field-error">{error}</p>}
        <button
          type="button"
          className="btn-outline"
          disabled={!online || !dirty || updateLocked || conflict}
          onClick={save}
        >
          {update.state.status === "saving" ? "保存中" : "変更を保存"}
        </button>

        {/* カテゴリ・担当・期限は行で選ぶとすぐ保存する（F-22〜F-24）。 */}
        <div className="todo-fields">
          <button
            type="button"
            className="todo-field-row"
            disabled={!online || fieldsLocked}
            onClick={() => setFieldSheet("category")}
          >
            <span className="todo-field-label">カテゴリ</span>
            <span className="todo-field-value">
              {categoryLabel}
              <CaretRight size={14} weight="bold" aria-hidden="true" />
            </span>
          </button>
          <button
            type="button"
            className="todo-field-row"
            disabled={!online || fieldsLocked}
            onClick={() => setFieldSheet("assignee")}
          >
            <span className="todo-field-label">担当</span>
            <span className="todo-field-value">
              {assigneeLabel}
              <CaretRight size={14} weight="bold" aria-hidden="true" />
            </span>
          </button>
          <button
            type="button"
            className="todo-field-row"
            disabled={!online || fieldsLocked}
            onClick={() => setFieldSheet("due")}
          >
            <span className="todo-field-label">期限</span>
            <span className="todo-field-value">
              {todo.dueOn === null ? "なし" : formatDueOn(todo.dueOn)}
              {badge !== null && (
                <span
                  className={
                    badge === "期限切れ"
                      ? "todo-field-badge todo-field-badge-over"
                      : "todo-field-badge"
                  }
                >
                  {badge}
                </span>
              )}
              <CaretRight size={14} weight="bold" aria-hidden="true" />
            </span>
          </button>
        </div>

        <div className="plan-detail-actions">
          {!isDone && (
            <p id={noteId} className="record-note">
              予定にする:
              日付と種類を選んで予定を作ります。保存すると、このToDoは完了になります。相手に通知は届きません。
            </p>
          )}
          <button
            type="button"
            className="btn-outline"
            disabled={!online || toggleSaving}
            onClick={() =>
              void (isDone
                ? reopen.submit(reopenTodoDraft(tripId, todoId))
                : complete.submit(completeTodoDraft(tripId, todoId)))
            }
          >
            {isDone ? (
              <ArrowCounterClockwise size={18} aria-hidden="true" />
            ) : (
              <CheckCircle size={18} aria-hidden="true" />
            )}
            {isDone ? "未完了に戻す" : "完了にする"}
          </button>
          <button
            type="button"
            className="btn-outline btn-outline-danger"
            disabled={!online}
            onClick={() => {
              remove.backToEditing();
              setConfirmingDelete(true);
            }}
          >
            <Trash size={18} aria-hidden="true" />
            削除する
          </button>
        </div>
      </div>

      {fieldSheet === "category" && (
        <Sheet
          title="カテゴリ"
          onClose={() => setFieldSheet(null)}
          closable={!fieldsBusy}
        >
          <div className="menu-card">
            <FieldOption
              label="未分類"
              current={todo.categoryId === null}
              disabled={fieldsBusy}
              onClick={() => patchFields({ categoryId: null })}
            />
            {todos.data.categories.map((category) => (
              <FieldOption
                key={category.id}
                label={category.name}
                current={todo.categoryId === category.id}
                disabled={fieldsBusy}
                onClick={() =>
                  patchFields({ categoryId: category.id })
                }
              />
            ))}
          </div>
        </Sheet>
      )}
      {fieldSheet === "assignee" && (
        <Sheet
          title="担当"
          onClose={() => setFieldSheet(null)}
          closable={!fieldsBusy}
        >
          <div className="menu-card">
            {userId !== null && (
              <FieldOption
                label="あなた"
                current={todo.assigneeId === userId}
                disabled={fieldsBusy}
                onClick={() => patchFields({ assigneeId: userId })}
              />
            )}
            {(participants ?? [])
              .filter((p) => p.userId !== userId)
              .map((p) => (
                <FieldOption
                  key={p.userId}
                  label={p.displayName}
                  current={todo.assigneeId === p.userId}
                  disabled={fieldsBusy}
                  onClick={() => patchFields({ assigneeId: p.userId })}
                />
              ))}
            <FieldOption
              label="未定"
              current={todo.assigneeId === null}
              disabled={fieldsBusy}
              onClick={() => patchFields({ assigneeId: null })}
            />
          </div>
        </Sheet>
      )}
      {fieldSheet === "due" && (
        <DueSheet
          todo={todo}
          today={today}
          disabled={fieldsBusy}
          onPick={(dueOn) => patchFields({ dueOn })}
          onClose={() => setFieldSheet(null)}
        />
      )}
      {confirmingDelete && (
        <Dialog
          title={`「${todo.name}」を削除しますか？`}
          onClose={() => {
            if (remove.state.status !== "saving") {
              setConfirmingDelete(false);
            }
          }}
        >
          <p className="dialog-body">
            削除すると、二人のリストから消え、元に戻せません。済んだだけなら「完了にする」を使ってください。
          </p>
          <div className="dialog-actions">
            <button
              type="button"
              className="btn-secondary"
              disabled={remove.state.status === "saving"}
              onClick={() => setConfirmingDelete(false)}
            >
              やめる
            </button>
            <button
              type="button"
              className="btn-danger"
              disabled={
                !online ||
                remove.state.status === "saving" ||
                deleteCheck.check.status !== "none"
              }
              onClick={() =>
                void remove.submit(deleteTodoDraft(tripId, todoId))
              }
            >
              削除する
            </button>
          </div>
        </Dialog>
      )}
      {toast !== null && (
        <Toast message={toast} onDismiss={() => setToast(null)} />
      )}
      <TripTabBar tripId={tripId} current="todos" action={mainAction} />
    </main>
  );
}

/** カテゴリ・担当の選び項目（いまの値には印を付ける）。 */
function FieldOption({
  label,
  current,
  disabled,
  onClick,
}: {
  label: string;
  current: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="menu-item"
      disabled={disabled}
      onClick={onClick}
    >
      <span className="menu-item-icon" aria-hidden="true">
        {current ? <Check size={18} weight="bold" /> : null}
      </span>
      <span className="menu-item-main">
        <span className="menu-item-label">{label}</span>
      </span>
    </button>
  );
}

/** 期限を決めるシート。決めたらすぐ送る。 */
function DueSheet({
  todo,
  today,
  disabled,
  onPick,
  onClose,
}: {
  todo: Todo;
  today: string;
  disabled: boolean;
  onPick: (dueOn: string | null) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(todo.dueOn ?? "");
  const preview = dueBadge(draft === "" ? null : draft, today);
  return (
    <Sheet
      title="期限"
      onClose={onClose}
      closable={!disabled}
      footer={
        <>
          {todo.dueOn !== null && (
            <button
              type="button"
              className="btn-secondary"
              disabled={disabled}
              onClick={() => onPick(null)}
            >
              期限を消す
            </button>
          )}
          <button
            type="button"
            className="btn-ink"
            disabled={disabled || draft === ""}
            onClick={() => onPick(draft)}
          >
            決定
          </button>
        </>
      }
    >
      <div className="field">
        <label className="field-label" htmlFor="todo-due">
          期限
        </label>
        <input
          id="todo-due"
          className="field-input"
          type="date"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        {preview !== null && (
          <p className="todo-meta">{preview}</p>
        )}
      </div>
    </Sheet>
  );
}

type TodoContent = Pick<Todo, "name" | "memo">;

/** 変えた項目だけを入れる。メモを空にしたらnull（消す）。 */
function patchOf(todo: Todo, name: string, memo: string): TodoPatch {
  const patch: TodoPatch = {};
  if (name !== todo.name) {
    patch.name = name;
  }
  const nextMemo = memo.trim() === "" ? null : memo;
  if (nextMemo !== todo.memo) {
    patch.memo = nextMemo;
  }
  return patch;
}
