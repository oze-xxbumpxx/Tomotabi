"use client";

import { CaretLeft } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { useMe } from "@/features/auth";
import {
  createPlanDraft,
  firstInvalidField,
  planCreateOf,
  planPatchOf,
  PlanFormFields,
  PLAN_KIND_LABEL,
  sendUpdatePlan,
  updatePlanDraft,
  useCreatePlan,
  usePlan,
  usePlanMutation,
  validatePlanForm,
  valuesOfPlan,
  type PlanFormChange,
  type PlanFormErrors,
  type PlanFormField,
  type PlanFormValues,
  type PlanSaveState,
} from "@/features/plans";
import { useTrip } from "@/features/trips";
import { ApiRequestError } from "@/shared/api/api-failure";
import { setPendingToast } from "@/shared/lib/pending-toast";
import { isLocalDateString } from "@/shared/lib/local-date";
import { ConflictNotice } from "@/shared/ui/state/conflict";
import { FetchFailed } from "@/shared/ui/state/fetch-failed";
import { Loading } from "@/shared/ui/state/loading";
import { NotAvailable } from "@/shared/ui/state/not-available";
import { OfflineBanner } from "@/shared/ui/state/offline-banner";
import { SaveUnknown } from "@/shared/ui/state/save-unknown";
import { SessionExpired } from "@/shared/ui/state/session-expired";
import { useOnlineStatus } from "@/shared/ui/state/use-online-status";
import { StatusText } from "@/shared/ui/status-text";

function fieldMessage(
  state: Extract<PlanSaveState, { status: "rejected" }>,
): string | null {
  if (state.httpStatus === 428) {
    return "画面を更新してからやり直してください";
  }
  switch (state.code) {
    case "PLAN_OUTSIDE_TRIP_PERIOD":
      return "その日付は旅行期間の外です。旅行の期間が変わっていないか確認してください";
    case "PLAN_CANCELLED":
      return "予定の状態が変わっています。閉じて開き直してください。";
    case "PLAN_HAS_RECORD_HISTORY":
      return "達成・予約の記録があるため、種類は変更できません";
    case "VALIDATION_FAILED":
    case "INVALID_REQUEST":
      return "入力内容を確認してください";
    default:
      return null;
  }
}

const EMPTY_VALUES = (date: string): PlanFormValues => ({
  name: "",
  kind: null,
  date,
  timeUndecided: true,
  time: "",
  memo: "",
});

/**
 * 予定の追加・編集（v3 に無い画面。11 と同じシートの組み方）。
 * 追加は `/trips/{tripId}/plans/new?date=`、編集は
 * `/trips/{tripId}/plans/{planId}/edit`。
 * - 編集の PATCH は変更のあった項目だけを送る（送っていない = 変えない）。
 *   何も変えずに閉じれば送らない。
 * - 達成・予約の記録がある予定は種類を固定し、理由の文を出す（W-19）。
 * - 保存成功で「追加しました」/「変更しました」を遷移先のトーストに渡す。
 */
export function PlanFormScreen({
  mode,
  tripId,
  planId,
  date,
}: {
  mode: "new" | "edit";
  tripId: string;
  /** 編集では必須。 */
  planId?: string;
  /** 追加の初期日（URL の `date`）。未指定は期間の初日。 */
  date?: string | null;
}) {
  const router = useRouter();
  const { state: meState } = useMe();
  const online = useOnlineStatus();
  const [values, setValues] = useState<PlanFormValues>(() =>
    EMPTY_VALUES(
      date !== null && date !== undefined && isLocalDateString(date)
        ? date
        : "",
    ),
  );
  const [errors, setErrors] = useState<PlanFormErrors>({});
  const nameRef = useRef<HTMLInputElement>(null);
  const kindRef = useRef<HTMLFieldSetElement>(null);
  const timeRef = useRef<HTMLInputElement>(null);
  const fieldRefs: Partial<
    Record<PlanFormField, RefObject<HTMLInputElement | null>>
  > = { name: nameRef, time: timeRef };

  // 追加は期間の日が要るので旅行を取る。編集は予定を取る。
  const tripQuery = useTrip(tripId, { enabled: mode === "new" });
  const planQuery = usePlan(tripId, planId ?? "", {
    enabled: mode === "edit",
  });

  const plan = mode === "edit" ? planQuery.data : undefined;
  const period =
    mode === "new"
      ? tripQuery.data !== undefined
        ? {
            startsOn: tripQuery.data.startsOn,
            endsOn: tripQuery.data.endsOn,
          }
        : null
      : null;

  // 編集は保存済みの値で欄を埋める（開いていたときの基準として保持する）。
  const savedRef = useRef<PlanFormValues | null>(null);
  const etagRef = useRef<string | null>(null);
  useEffect(() => {
    if (mode === "edit" && plan !== undefined && savedRef.current === null) {
      savedRef.current = valuesOfPlan(plan);
      etagRef.current = `"${plan.version}"`;
      setValues(valuesOfPlan(plan));
    }
  }, [mode, plan]);

  // 追加で日が未指定なら期間の初日を初期値にする（設計書「v3 に無い画面」）。
  useEffect(() => {
    if (
      mode === "new" &&
      tripQuery.data !== undefined &&
      values.date === ""
    ) {
      const startsOn = tripQuery.data.startsOn;
      setValues((current) =>
        current.date === "" ? { ...current, date: startsOn } : current,
      );
    }
  }, [mode, tripQuery.data, values.date]);

  const create = useCreatePlan({
    tripId,
    onSucceeded: (result) => {
      setPendingToast("追加しました");
      router.replace(
        `/trips/${tripId}/itinerary?date=${result.data.date}`,
      );
    },
  });
  const update = usePlanMutation({
    tripId,
    planId: planId ?? "",
    send: sendUpdatePlan,
    onSucceeded: () => {
      setPendingToast("変更しました");
      router.replace(`/trips/${tripId}/plans/${planId}`);
    },
  });
  const save = mode === "new" ? create : update;
  const state = save.state;

  // conflict の最新値で欄を埋め直すときの基準になる ETag。
  const etagNow =
    state.status === "conflict" && state.latest !== null
      ? state.latest.etag
      : (etagRef.current ?? "");

  useEffect(() => {
    if (meState.status === "unauthenticated") {
      router.replace("/sign-in");
    }
  }, [meState.status, router]);

  // 保存が「期間外」で拒否されたら期間を取り直し（07 §10）。
  // 日付欄のエラーとして表示するのは下の displayErrors。
  const refetchTrip = tripQuery.refetch;
  useEffect(() => {
    if (
      mode === "new" &&
      state.status === "rejected" &&
      state.code === "PLAN_OUTSIDE_TRIP_PERIOD"
    ) {
      void refetchTrip();
    }
  }, [mode, state, refetchTrip]);

  const applyChange = (change: PlanFormChange) => {
    setValues((current) => ({
      ...current,
      [change.field]: change.value,
    }));
    setErrors((current) => {
      const next = { ...current };
      if (change.field === "timeUndecided") {
        // 「時刻未定」に切り替えたら時刻のエラーは消える。
        delete next.time;
        return next;
      }
      if (current[change.field] === undefined) {
        return current;
      }
      delete next[change.field];
      return next;
    });
  };

  const submit = () => {
    if (state.status === "saving" || state.status === "unknown") {
      return;
    }
    const nextErrors = validatePlanForm(values, period);
    setErrors(nextErrors);
    const invalid = firstInvalidField(nextErrors);
    if (invalid !== null) {
      if (invalid === "kind") {
        kindRef.current?.focus();
      } else {
        fieldRefs[invalid]?.current?.focus();
      }
      return;
    }
    if (mode === "new") {
      if (values.kind === null) {
        return;
      }
      void create.submit(
        createPlanDraft(tripId, planCreateOf({ ...values, kind: values.kind })),
      );
      return;
    }
    if (plan === undefined) {
      return;
    }
    const patch = planPatchOf(plan, values);
    // 何も変わっていなければ送らずに閉じる。
    if (Object.keys(patch).length === 0) {
      tryClose();
      return;
    }
    void update.submit(
      updatePlanDraft(tripId, planId ?? "", patch, etagNow),
    );
  };

  const backHref =
    mode === "new"
      ? `/trips/${tripId}/itinerary${values.date !== "" ? `?date=${values.date}` : ""}`
      : `/trips/${tripId}/plans/${planId}`;

  const tryClose = () => {
    if (state.status === "saving" || state.status === "unknown") {
      return;
    }
    router.push(backHref);
  };

  // C-1 セッション切れ。
  if (state.status === "session-expired") {
    return (
      <main>
        <SessionExpired
          unconfirmedTarget={state.unconfirmed ? "予定" : null}
          onGoToSignIn={() => router.push("/sign-in")}
        />
      </main>
    );
  }

  // C-2 開けない（読み取り・書き込みのどちらの 403 / 404 も同じ扱い）。
  const queryFailure =
    mode === "new"
      ? tripQuery.error instanceof ApiRequestError
        ? tripQuery.error.failure
        : null
      : planQuery.error instanceof ApiRequestError
        ? planQuery.error.failure
        : null;
  const queryNotAvailable =
    queryFailure !== null &&
    queryFailure.kind === "http" &&
    (queryFailure.status === 403 || queryFailure.status === 404) &&
    (mode === "new"
      ? tripQuery.data === undefined
      : planQuery.data === undefined);
  // 書き込みの 403 / 404 も C-2（403 は旅行、404 は予定が無い）。
  const writeNotAvailable =
    state.status === "rejected" &&
    (state.httpStatus === 403 || state.httpStatus === 404);
  if (writeNotAvailable || queryNotAvailable) {
    const item404 =
      (writeNotAvailable && state.httpStatus === 404) ||
      (queryNotAvailable &&
        queryFailure?.status === 404 &&
        mode === "edit");
    const target = item404 ? "item" : "trip";
    return (
      <main>
        <NotAvailable
          target={target}
          onGoToTrips={() => router.push("/trips")}
          onGoToParent={{
            label: "しおりに戻る",
            onClick: () => router.push(`/trips/${tripId}/itinerary`),
          }}
        />
      </main>
    );
  }

  // 読み取りの 401 は業務データを隠して C-1。
  if (
    queryFailure !== null &&
    queryFailure.kind === "http" &&
    queryFailure.status === 401
  ) {
    return (
      <main>
        <SessionExpired onGoToSignIn={() => router.push("/sign-in")} />
      </main>
    );
  }

  // 編集はデータが届いたあと欄の hydrate を待つが、取得が失敗した
  // （データが無い）ときは失敗の画面に進ませる。
  const loading =
    mode === "new"
      ? tripQuery.isPending
      : planQuery.isPending ||
        (planQuery.data !== undefined && savedRef.current === null);
  if (loading) {
    return (
      <main>
        <Loading />
      </main>
    );
  }
  if (mode === "new" && tripQuery.data === undefined) {
    return (
      <main>
        <FetchFailed onRetry={() => void tripQuery.refetch()} />
      </main>
    );
  }
  if (mode === "edit" && plan === undefined) {
    return (
      <main>
        <FetchFailed onRetry={() => void planQuery.refetch()} />
      </main>
    );
  }

  const locked = state.status === "saving" || state.status === "unknown";

  // 「期間外」の拒否は上部の文ではなく日付欄のエラーにする（追加だけ。
  // 編集は日付欄が無いので上部の文のまま）。
  const outsideRejected =
    state.status === "rejected" &&
    state.code === "PLAN_OUTSIDE_TRIP_PERIOD";
  const showDateError = outsideRejected && mode === "new";
  const displayErrors: PlanFormErrors = showDateError
    ? {
        ...errors,
        date: "その日付は旅行期間の外です。旅行の期間が変わっていないか確認してください",
      }
    : errors;
  const topMessage =
    state.status === "rejected" && !showDateError
      ? (fieldMessage(state) ??
        "保存できませんでした。もう一度お試しください。")
      : null;

  const kindLockedReason =
    mode === "edit" && plan !== undefined && !plan.canChangeKind
      ? "達成・予約の記録があるため、種類は変更できません"
      : null;

  return (
    <main className="plan-page">
      {!online && (
        <OfflineBanner
          at={
            mode === "new"
              ? new Date(tripQuery.dataUpdatedAt)
              : new Date(planQuery.dataUpdatedAt)
          }
        />
      )}
      <header className="plan-detail-header">
        <Link className="plan-back" href={backHref}>
          <CaretLeft size={18} weight="bold" aria-hidden="true" />
          {mode === "new" ? "しおり" : "予定"}
        </Link>
      </header>
      <h1 className="plan-form-title">
        {mode === "new" ? "予定を追加" : "予定を編集"}
      </h1>
      {state.status === "conflict" &&
        state.latest !== null &&
        plan !== undefined && values.kind !== null && (
          <ConflictNotice
            rows={[
              {
                label: "名前",
                mine: values.name.trim(),
                latest:
                  state.latest.data.name === values.name.trim()
                    ? null
                    : state.latest.data.name,
              },
              {
                label: "種類",
                mine: PLAN_KIND_LABEL[values.kind],
                latest:
                  state.latest.data.kind === values.kind
                    ? null
                    : PLAN_KIND_LABEL[state.latest.data.kind],
              },
              {
                label: "時刻",
                mine: values.timeUndecided ? "未定" : values.time,
                latest:
                  (values.timeUndecided
                    ? null
                    : values.time) === state.latest.data.time
                    ? null
                    : (state.latest.data.time ?? "未定"),
              },
              {
                label: "メモ",
                mine: values.memo,
                latest:
                  (values.memo.trim() === "" ? null : values.memo.trim()) ===
                  state.latest.data.memo
                    ? null
                    : (state.latest.data.memo ?? "なし"),
              },
            ]}
            onSaveMine={() => {
              // 同じ要求を最新の ETag と新しいキーで送り直す。
              void update.saveMineOverLatest();
            }}
            onUseLatest={() => {
              if (state.latest !== null) {
                savedRef.current = valuesOfPlan(state.latest.data);
                etagRef.current = state.latest.etag;
                setValues(valuesOfPlan(state.latest.data));
              }
              update.backToEditing();
            }}
          />
        )}
      {state.status === "conflict" &&
        state.latest === null &&
        (state.latestFailed ? (
          <>
            <StatusText tone="error">
              最新の内容を取得できませんでした。
            </StatusText>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => void update.reloadLatest()}
            >
              再試行
            </button>
          </>
        ) : (
          <StatusText>読み込み中です</StatusText>
        ))}
      {state.status !== "conflict" && (
        <>
          {state.status === "unknown" && (
            <SaveUnknown
              onConfirm={() => void save.confirmWithSameRequest()}
            />
          )}
          {state.status === "rejected" && topMessage !== null && (
            <StatusText tone="error">{topMessage}</StatusText>
          )}
          <PlanFormFields
            values={values}
            errors={displayErrors}
            locked={locked}
            period={period}
            kindLockedReason={kindLockedReason}
            fieldRefs={fieldRefs}
            kindRef={kindRef}
            onChange={applyChange}
          />
          <div className="plan-form-actions">
            <button
              type="button"
              className="btn-secondary"
              onClick={tryClose}
              disabled={locked}
            >
              やめる
            </button>
            <button
              type="button"
              className="btn-ink"
              onClick={submit}
              disabled={
                locked ||
                !online ||
                // 拒否のあとに同じ古い ETag で再送するボタンは出さない。
                // 閉じて開き直すと最新の ETag で送れる。
                (mode === "edit" && state.status === "rejected")
              }
            >
              {state.status === "saving" ? "保存中" : "保存する"}
            </button>
          </div>
        </>
      )}
    </main>
  );
}
