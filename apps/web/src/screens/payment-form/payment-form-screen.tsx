"use client";

import { useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { useMe } from "@/features/auth";
import {
  CREATE_PAYMENT_OPERATION,
  createPaymentDraft,
  firstInvalidField,
  paymentBodyFromJson,
  paymentCreateOf,
  PaymentFormFields,
  useBalance,
  useCreatePayment,
  validatePaymentForm,
  valuesOfPendingBody,
  type PaymentFormChange,
  type PaymentFormErrors,
  type PaymentFormField,
  type PaymentFormValues,
  type PaymentSaveState,
  type PlanRowState,
  type SelectedPlan,
} from "@/features/payments";
import { usePlan } from "@/features/plans";
import { useTrip } from "@/features/trips";
import { usePendingRequestCheck } from "@/shared/browser/use-pending-request-check";
import { ApiRequestError } from "@/shared/api/api-failure";
import { setPendingToast } from "@/shared/lib/pending-toast";
import { ItineraryScreen } from "@/screens/itinerary/itinerary-screen";
import { FetchFailed } from "@/shared/ui/state/fetch-failed";
import { Loading } from "@/shared/ui/state/loading";
import { NotAvailable } from "@/shared/ui/state/not-available";
import { OfflineBanner } from "@/shared/ui/state/offline-banner";
import { SaveUnknown } from "@/shared/ui/state/save-unknown";
import { SessionExpired } from "@/shared/ui/state/session-expired";
import { StorageUnavailable } from "@/shared/ui/state/storage-unavailable";
import { Sheet } from "@/shared/ui/sheet";
import { useOnlineStatus } from "@/shared/ui/state/use-online-status";
import { StatusText } from "@/shared/ui/status-text";
import { PlanPickSheet } from "./plan-pick-sheet";

const EMPTY_VALUES: PaymentFormValues = {
  amount: "",
  payerUserId: null,
  mode: "half",
  myPercent: "50",
  label: "",
  plan: null,
};

/** 保存の拒否を画面上部の文にする。フィールドのエラーは別扱い。 */
function rejectedMessage(
  state: Extract<PaymentSaveState, { status: "rejected" }>,
): string | null {
  if (state.httpStatus === 428) {
    return "画面を更新してからやり直してください";
  }
  switch (state.code) {
    case "VALIDATION_FAILED":
      return "入力内容を確認してください";
    case "PLAN_NOT_FOUND":
      return "関連する予定が見つかりません。選び直してください";
    case "IDEMPOTENCY_KEY_REUSED":
      return "同じ要求が既に記録されています。開き直してください";
    case "TRIP_NOT_ACCESSIBLE":
      return "この旅行にはアクセスできません";
    default:
      return null;
  }
}

/**
 * 支払いを記録（v3 11・11b）。`/trips/{tripId}/payments/new?planId=`。
 * しおりの上に重ねるシート。保存は保留中の要求（IndexedDB）を通し、
 * 同じ利用者・旅行・操作の保留があれば入力を固定して「保存されたか
 * 確認できません」と「同じ内容で確認する」を出す（ADR-0006・F-50〜F-53）。
 * URL の planId は getPlan で同じ旅行の予定か確かめてから選んだ状態に
 * する。確認できないときは勝手に関連なしへ変えず、再取得か解除を促す。
 */
export function PaymentFormScreen({
  tripId,
  planId,
}: {
  tripId: string;
  /** URL の `planId`（予定の詳細から開いた入口。無ければ null）。 */
  planId: string | null;
}) {
  const router = useRouter();
  const { state: meState, reload: reloadMe } = useMe();
  const online = useOnlineStatus();
  const meUserId =
    meState.status === "ready" ? meState.me.user.id : null;

  const [values, setValues] = useState<PaymentFormValues>(EMPTY_VALUES);
  const [errors, setErrors] = useState<PaymentFormErrors>({});
  const [hydrated, setHydrated] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  // URL の予定の確認: pending（getPlan で確認中）→ none（選択済み・解除）
  // / failed（確認に失敗。勝手に関連なしへ変えず再取得か解除を待つ）。
  const [urlPlanCheck, setUrlPlanCheck] = useState<
    "pending" | "none" | "failed"
  >(planId !== null ? "pending" : "none");

  const amountRef = useRef<HTMLInputElement>(null);
  const myPercentRef = useRef<HTMLInputElement>(null);
  const labelRef = useRef<HTMLInputElement>(null);
  const fieldRefs: Partial<
    Record<PaymentFormField, RefObject<HTMLInputElement | null>>
  > = { amount: amountRef, myPercent: myPercentRef, label: labelRef };

  const tripQuery = useTrip(tripId);
  const balanceQuery = useBalance(tripId);
  const { check } = usePendingRequestCheck({
    userId: meUserId,
    tripId,
    operation: CREATE_PAYMENT_OPERATION,
  });

  const pendingRecord = check.status === "found" ? check.record : null;
  const locked = pendingRecord !== null;
  const storedBody =
    pendingRecord !== null && pendingRecord.bodyJson !== null
      ? paymentBodyFromJson(pendingRecord.bodyJson)
      : null;

  // 確認が要る予定は 1 件だけ: 固定表示は保留の planId、編集中は URL の planId。
  const displayPlanId = locked
    ? (storedBody?.planId ?? null)
    : urlPlanCheck !== "none"
      ? planId
      : null;
  const planQuery = usePlan(tripId, displayPlanId ?? "", {
    enabled: displayPlanId !== null,
  });

  const participants = balanceQuery.data?.participants ?? [];
  const meParticipant = participants.find((p) => p.userId === meUserId);

  // 支払者の初期値は自分（07 §6）。
  useEffect(() => {
    if (!locked && !hydrated && meUserId !== null) {
      setValues((current) => ({ ...current, payerUserId: meUserId }));
      setHydrated(true);
    }
  }, [locked, hydrated, meUserId]);

  // URL の予定を getPlan で確かめて選んだ状態にする（別の旅行の予定は
  // 404 になり failed へ。選び直しは選んだ日の getItinerary を使う）。
  useEffect(() => {
    if (locked || urlPlanCheck !== "pending") {
      return;
    }
    if (planQuery.data !== undefined) {
      const plan = planQuery.data;
      setValues((current) => ({
        ...current,
        plan: { id: plan.id, date: plan.date, name: plan.name },
      }));
      setUrlPlanCheck("none");
      return;
    }
    if (planQuery.isError && !planQuery.isFetching) {
      setUrlPlanCheck("failed");
    }
  }, [locked, urlPlanCheck, planQuery]);

  const save = useCreatePayment({
    tripId,
    userId: meUserId ?? "",
    check,
    onSucceeded: () => {
      setPendingToast("支払いを記録しました");
      router.replace(`/trips/${tripId}/itinerary`);
    },
  });
  const state = save.state;

  useEffect(() => {
    if (meState.status === "unauthenticated") {
      router.replace("/sign-in");
    }
  }, [meState.status, router]);

  const applyChange = (change: PaymentFormChange) => {
    // 拒否のあと欄を直したら編集に戻る（サーバーは拒否した要求で
    // 支払いを作らない。428 は最新を取り直すまで送り直せない）。
    if (state.status === "rejected" && state.httpStatus !== 428) {
      save.backToEditing();
    }
    setValues((current) => ({ ...current, [change.field]: change.value }));
    setErrors((current) => {
      const next = { ...current };
      // 分け方を変えたら「自分の負担」のエラーは消える。
      if (change.field === "mode") {
        delete next.myPercent;
        return next;
      }
      if (current[change.field as PaymentFormField] === undefined) {
        return current;
      }
      delete next[change.field as PaymentFormField];
      return next;
    });
  };

  const submit = () => {
    if (state.status === "saving" || state.status === "unknown") {
      return;
    }
    const nextErrors = validatePaymentForm(values);
    setErrors(nextErrors);
    const invalid = firstInvalidField(nextErrors);
    if (invalid !== null) {
      fieldRefs[invalid]?.current?.focus();
      return;
    }
    const payer = participants.find(
      (p) => p.userId === values.payerUserId,
    );
    if (payer === undefined || meParticipant === undefined) {
      return;
    }
    const body = paymentCreateOf(values, payer, meParticipant, participants);
    if (body === null) {
      return;
    }
    void save.submit(createPaymentDraft(tripId, body));
  };

  const backHref = `/trips/${tripId}/itinerary`;
  const tryClose = () => {
    if (state.status === "saving" || state.status === "unknown") {
      return;
    }
    router.push(backHref);
  };

  // C-1 セッション切れ（保存の 401。unconfirmed は結果不明のあとの確認）。
  if (state.status === "session-expired") {
    return (
      <main>
        <SessionExpired
          unconfirmedTarget={state.unconfirmed ? "支払い" : null}
          onGoToSignIn={() => router.push("/sign-in")}
        />
      </main>
    );
  }

  // 読み取り・書き込みの 403 / 404 は C-2（403 は旅行、404 は旅行の不在）。
  const queryFailures = [tripQuery, balanceQuery].map((query) =>
    query.error instanceof ApiRequestError ? query.error.failure : null,
  );
  const queryNotAvailable = [tripQuery, balanceQuery].some(
    (query, index) => {
      const failure = queryFailures[index];
      return (
        failure !== null &&
        failure.kind === "http" &&
        (failure.status === 403 || failure.status === 404) &&
        query.data === undefined
      );
    },
  );
  const writeNotAvailable =
    state.status === "rejected" &&
    (state.httpStatus === 403 || state.httpStatus === 404);
  if (writeNotAvailable || queryNotAvailable) {
    return (
      <main>
        <NotAvailable
          target="trip"
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
    queryFailures.some(
      (failure) =>
        failure !== null && failure.kind === "http" && failure.status === 401,
    )
  ) {
    return (
      <main>
        <SessionExpired onGoToSignIn={() => router.push("/sign-in")} />
      </main>
    );
  }

  // 利用者の情報が取れないと払った人・割合・保留の照合が作れない。
  if (meState.status === "error" || meState.status === "unavailable") {
    return (
      <main>
        <FetchFailed
          message="利用者の情報を取得できませんでした"
          onRetry={() => void reloadMe()}
        />
      </main>
    );
  }

  const planFetchPending =
    displayPlanId !== null &&
    (planQuery.isPending || planQuery.isFetching);
  const loading =
    meUserId === null ||
    tripQuery.isPending ||
    balanceQuery.isPending ||
    check.status === "checking" ||
    (!locked && !hydrated) ||
    planFetchPending;

  const underlying = <ItineraryScreen tripId={tripId} />;

  if (loading || meUserId === null) {
    return (
      <>
        {underlying}
        <Sheet key="loading" title="支払いを記録" onClose={tryClose}>
          <Loading />
        </Sheet>
      </>
    );
  }

  if (tripQuery.data === undefined || balanceQuery.data === undefined) {
    return (
      <main>
        <FetchFailed
          onRetry={() => {
            void tripQuery.refetch();
            void balanceQuery.refetch();
          }}
        />
      </main>
    );
  }

  const period = {
    startsOn: tripQuery.data.startsOn,
    endsOn: tripQuery.data.endsOn,
  };

  // 固定表示用の値（保留の本文から復元）。形が確かめられないものは
  // 欄を出さず、確認の操作だけを出す。
  const lockedPlan: SelectedPlan | null =
    locked &&
    planQuery.data !== undefined &&
    storedBody?.planId === planQuery.data.id
      ? {
          id: planQuery.data.id,
          date: planQuery.data.date,
          name: planQuery.data.name,
        }
      : null;
  const lockedValues =
    storedBody !== null && meParticipant !== undefined
      ? valuesOfPendingBody(
          storedBody,
          meParticipant,
          participants,
          lockedPlan,
        )
      : null;

  const planRowState: PlanRowState = locked
    ? storedBody?.planId !== null &&
      storedBody?.planId !== undefined &&
      planQuery.isError &&
      !planQuery.isFetching
      ? "failed"
      : "ready"
    : urlPlanCheck === "failed"
      ? "failed"
      : "ready";

  const planRetry = () => {
    if (locked) {
      void planQuery.refetch();
      return;
    }
    setUrlPlanCheck("pending");
    void planQuery.refetch();
  };
  const planClear = () => {
    // 利用者の解除だけが関連なしへ進める（自動では変えない）。
    setUrlPlanCheck("none");
  };

  const fieldsLocked =
    locked || state.status === "saving" || state.status === "unknown";
  const topMessage =
    state.status === "rejected"
      ? (rejectedMessage(state) ??
        "保存できませんでした。もう一度お試しください。")
      : null;

  const shownValues = locked ? lockedValues : values;

  return (
    <>
      {underlying}
      <Sheet
        key="form"
        title="支払いを記録"
        onClose={tryClose}
        initialFocus={locked ? undefined : amountRef}
        footer={
          locked ? (
            <button
              type="button"
              className="btn-secondary"
              onClick={tryClose}
            >
              やめる
            </button>
          ) : state.status === "conflict" ? null : (
            <>
              <button
                type="button"
                className="btn-secondary"
                onClick={tryClose}
                disabled={fieldsLocked}
              >
                やめる
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={submit}
                disabled={
                  fieldsLocked ||
                  !online ||
                  check.status !== "none" ||
                  (state.status === "rejected" && state.httpStatus === 428)
                }
              >
                {state.status === "saving" ? "保存中" : "保存"}
              </button>
            </>
          )
        }
      >
        {!online && (
          <OfflineBanner at={new Date(tripQuery.dataUpdatedAt)} />
        )}
        {/* 保留があるあいだ（および確認自体が結果不明のとき）は
            「保存されたか確認できません」と「同じ内容で確認する」だけを出す。
            確定した拒否のあとはバナーを消して欄の固定は維持する。 */}
        {(locked || state.status === "unknown") &&
          state.status !== "rejected" &&
          state.status !== "succeeded" && (
            <SaveUnknown
              onConfirm={() => {
                if (state.status === "unknown" || pendingRecord === null) {
                  void save.confirmWithSameRequest();
                  return;
                }
                void save.confirmRequest(pendingRecord);
              }}
              confirming={state.status === "saving"}
            />
          )}
        {state.status === "storage-unavailable" && <StorageUnavailable />}
        {check.status === "unavailable" && !locked && (
          <StorageUnavailable />
        )}
        {topMessage !== null && (
          <StatusText tone="error">{topMessage}</StatusText>
        )}
        {state.status === "rejected" && state.httpStatus === 428 && (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              void tripQuery.refetch();
              void balanceQuery.refetch();
              save.backToEditing();
            }}
          >
            最新を取り直す
          </button>
        )}
        {state.status === "conflict" && (
          <StatusText tone="error">
            別の変更と競合しました。開き直してください。
          </StatusText>
        )}
        {state.status !== "conflict" && shownValues !== null && (
          <PaymentFormFields
            values={shownValues}
            errors={locked ? {} : errors}
            locked={fieldsLocked}
            participants={participants}
            meUserId={meUserId}
            planRowState={planRowState}
            fieldRefs={fieldRefs}
            onChange={applyChange}
            onOpenPlanPicker={() => setPickerOpen(true)}
            onPlanRetry={planRetry}
            onPlanClear={planClear}
          />
        )}
      </Sheet>
      {pickerOpen && !locked && (
        <PlanPickSheet
          tripId={tripId}
          period={period}
          current={values.plan}
          onPick={(plan) => {
            setValues((current) => ({ ...current, plan }));
            setPickerOpen(false);
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </>
  );
}
