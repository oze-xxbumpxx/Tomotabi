"use client";

import { CaretRight, Check } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import type { Todo } from "@tomotabi/contracts";
import { useMe } from "@/features/auth";
import { useBalance } from "@/features/payments";
import {
  CREATE_TODO_OPERATION,
  completeTodoDraft,
  createTodoDraft,
  invalidateTodos,
  reopenTodoDraft,
  replaceTodoInList,
  sendCompleteTodo,
  sendCreateTodo,
  sendReopenTodo,
  useTodos,
  useTodoSave,
} from "@/features/todos";
import { TripTabBar, useTrip } from "@/features/trips";
import { ApiRequestError } from "@/shared/api/api-failure";
import { usePendingRequestCheck } from "@/shared/browser/use-pending-request-check";
import { formatLocalDate, formatTripPeriod } from "@/shared/lib/local-date";
import { takePendingToast } from "@/shared/lib/pending-toast";
import { boundedTextLength } from "@/shared/lib/text-length";
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

const NAME_MAX = 100;

/**
 * `/trips/{tripId}/todos`のToDoのリスト（設計書 trip-todo「フロントエンド設計」、
 * Claude Designの見本「ToDo · 項目がある」「ToDo · 0件」）。
 * 上の一行の欄から追加し、「まだ」「済んだ」に分けて並べる。
 * 完了の印は押すとすぐ済んだ欄に移し、保存できなければ戻す。
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
  const create = useTodoSave({
    tripId,
    userId,
    send: sendCreateTodo,
    check: createCheck.check,
    onSucceeded: () => setName(""),
  });
  const queryClient = useQueryClient();
  // 保存できた値で一覧の項目を先に置き換えてから、押した直後の見た目を消す
  // （取り直しを待つあいだに「まだ」へ一度戻らないようにする）。
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

  useEffect(() => {
    const pending = takePendingToast();
    if (pending !== null) {
      setToast(pending);
    }
  }, []);

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

  const failure =
    todos.error instanceof ApiRequestError ? todos.error.failure : null;
  const saves = [create.state, complete.state, reopen.state];
  const expired = saves.find((state) => state.status === "session-expired");
  if (
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

  const items = todos.data.items.map((item) =>
    toggling !== null && toggling.id === item.id
      ? withDone(item, toggling.done, userId)
      : item,
  );
  const open = items.filter((item) => item.doneAt === null);
  const done = items.filter((item) => item.doneAt !== null);
  const participants = balance.data?.participants;
  const actorLine = (todo: Todo) => todoActorLine(todo, userId, participants);

  const pendingBlocked = createCheck.check.status !== "none";
  const createLocked =
    create.state.status === "saving" || create.state.status === "unknown";

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
    void create.submit(createTodoDraft(tripId, trimmed));
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

  const rejected = saves.find((state) => state.status === "rejected");

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
      {[create, complete, reopen].map((save, index) =>
        save.state.status === "unknown" ? (
          <SaveUnknown
            key={index}
            onConfirm={() => void save.confirmWithSameRequest()}
          />
        ) : null,
      )}
      {(createCheck.check.status === "unavailable" ||
        saves.some((state) => state.status === "storage-unavailable")) && (
        <StorageUnavailable />
      )}
      {rejected !== undefined && (
        <StatusText tone="error">
          {rejected.status === "rejected" && rejected.httpStatus === 404
            ? "このToDoは相手が削除しました。リストを読み直しました"
            : rejected.status === "rejected" &&
                rejected.code === "TODO_LIMIT_REACHED"
              ? "ToDoは1つの旅行に200件までです。済んだものを削除してから追加してください"
              : "保存できませんでした。もう一度お試しください。"}
        </StatusText>
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

      <form
        className="todo-add"
        aria-label="ToDoを追加する"
        onSubmit={submit}
        noValidate
      >
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

      {items.length === 0 ? (
        <div className="todo-empty">
          <p className="todo-empty-title">ToDoはまだありません</p>
          <p className="todo-empty-body">
            上の欄に書いて「追加する」を押すと、二人で同じリストを見られます。日付が決まったら、予定にできます。
          </p>
        </div>
      ) : (
        <>
          <section className="todo-section" aria-label="まだのもの">
            <h2 className="todo-section-title">{`まだ · ${open.length}件`}</h2>
            {open.length === 0 ? (
              <p className="record-empty-text">すべて済みました</p>
            ) : (
              <ul className="todo-list">
                {open.map((todo) => (
                  <li key={todo.id} className="todo-row">
                    <button
                      type="button"
                      className="todo-check"
                      aria-label={`「${todo.name}」を完了にする`}
                      disabled={!online || toggling !== null}
                      onClick={() => toggle(todo)}
                    />
                    <Link
                      className="todo-row-main"
                      href={`/trips/${tripId}/todos/${todo.id}`}
                    >
                      <span className="todo-name">{todo.name}</span>
                      <span className="todo-meta">
                        {todo.memo !== null
                          ? `${actorLine(todo)} · メモあり`
                          : actorLine(todo)}
                      </span>
                    </Link>
                    <CaretRight
                      size={16}
                      aria-hidden="true"
                      className="todo-caret"
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>

          {done.length > 0 && (
            <section className="todo-section" aria-label="済んだもの">
              <h2 className="todo-section-title">{`済んだ · ${done.length}件`}</h2>
              <ul className="todo-list">
                {done.map((todo) => (
                  <li key={todo.id} className="todo-row todo-row-done">
                    <button
                      type="button"
                      className="todo-check todo-check-done"
                      aria-label={`「${todo.name}」を未完了に戻す`}
                      disabled={!online || toggling !== null}
                      onClick={() => toggle(todo)}
                    >
                      <Check size={14} weight="bold" aria-hidden="true" />
                    </button>
                    <div className="todo-row-main">
                      <Link
                        className="todo-name todo-name-done"
                        href={`/trips/${tripId}/todos/${todo.id}`}
                      >
                        {todo.name}
                      </Link>
                      <span className="todo-meta">
                        {actorLine(todo)}
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
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {toast !== null && (
        <Toast message={toast} onDismiss={() => setToast(null)} />
      )}
      <TripTabBar tripId={tripId} current="todos" action={null} />
    </main>
  );
}

/** 完了の印を押した直後の見た目。完了者は押した本人にしておく。 */
function withDone(todo: Todo, done: boolean, userId: string | null): Todo {
  if (done) {
    return todo.doneAt !== null
      ? todo
      : {
          ...todo,
          doneAt: new Date().toISOString(),
          doneBy: userId,
          plan: null,
        };
  }
  return { ...todo, doneAt: null, doneBy: null, plan: null };
}
