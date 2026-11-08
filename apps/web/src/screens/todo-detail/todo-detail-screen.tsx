"use client";

import {
  CalendarPlus,
  CaretLeft,
  CheckCircle,
  ArrowCounterClockwise,
  Trash,
} from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import type { Todo, TodoPatch } from "@tomotabi/contracts";
import { useMe } from "@/features/auth";
import { useBalance } from "@/features/payments";
import {
  completeTodoDraft,
  DELETE_TODO_OPERATION,
  deleteTodoDraft,
  reopenTodoDraft,
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
  const [toast, setToast] = useState<string | null>(null);

  const userId = meState.status === "ready" ? meState.me.user.id : null;
  const listHref = `/trips/${tripId}/todos`;

  const updateCheck = usePendingRequestCheck({
    userId,
    tripId,
    operation: UPDATE_TODO_OPERATION,
  });
  const deleteCheck = usePendingRequestCheck({
    userId,
    tripId,
    operation: DELETE_TODO_OPERATION,
  });
  const update = useTodoSave({
    tripId,
    userId,
    send: sendUpdateTodo,
    check: updateCheck.check,
    onSucceeded: () => {
      setName(null);
      setMemo(null);
      setToast("変更しました");
    },
  });
  const complete = useTodoSave({ tripId, userId, send: sendCompleteTodo });
  const reopen = useTodoSave({ tripId, userId, send: sendReopenTodo });
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

  const failure =
    todos.error instanceof ApiRequestError ? todos.error.failure : null;
  const saves = [update.state, complete.state, reopen.state, remove.state];
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
  const backToList = { label: "ToDoに戻る", onClick: () => router.push(listHref) };
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
    if (remove.state.status === "succeeded" || remove.state.status === "saving") {
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

  const shownName = name ?? todo.name;
  const shownMemo = memo ?? todo.memo ?? "";
  const dirty = shownName !== todo.name || shownMemo !== (todo.memo ?? "");
  const updateLocked =
    update.state.status === "saving" ||
    update.state.status === "unknown" ||
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
    const patch = patchOf(todo, trimmed, shownMemo);
    if (Object.keys(patch).length === 0) {
      return;
    }
    void update.submit(updateTodoDraft(tripId, todoId, patch, todo.version));
  };

  const participants = balance.data?.participants;
  const isDone = todo.doneAt !== null;
  const mainAction = isDone
    ? undefined
    : {
        label: "予定にする",
        icon: <CalendarPlus size={20} weight="fill" aria-hidden="true" />,
        onPress: () =>
          router.push(`/trips/${tripId}/plans/new?fromTodo=${todoId}`),
        disabled: !online || dirty,
        describedBy: noteId,
      };

  const conflict = update.state.status === "conflict";
  const rejected = saves.find(
    (state) => state.status === "rejected" && state.httpStatus !== 404,
  );

  return (
    <main className="todo-page">
      {!online && <OfflineBanner at={new Date(todos.dataUpdatedAt)} />}
      {[update, complete, reopen, remove].map((s, index) =>
        s.state.status === "unknown" ? (
          <SaveUnknown key={index} onConfirm={() => void s.confirmWithSameRequest()} />
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
              void todos.refetch();
            }}
          >
            最新の内容を読み込む
          </button>
        </div>
      )}
      {rejected !== undefined && !conflict && (
        <StatusText tone="error">保存できませんでした。もう一度お試しください。</StatusText>
      )}

      <header className="plan-detail-header">
        <Link className="plan-back" href={listHref}>
          <CaretLeft size={18} weight="bold" aria-hidden="true" />
          ToDo
        </Link>
      </header>

      <div className="todo-detail">
        <p className="todo-detail-status">
          <span className={isDone ? "todo-badge todo-badge-done" : "todo-badge"}>
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

        <div className="plan-detail-actions">
          {!isDone && (
            <p id={noteId} className="record-note">
              予定にする: 日付と種類を選んで予定を作ります。保存すると、このToDoは完了になります。相手に通知は届きません。
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
              onClick={() => void remove.submit(deleteTodoDraft(tripId, todoId))}
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
