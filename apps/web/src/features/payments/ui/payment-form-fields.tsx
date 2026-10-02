"use client";

import { CaretRight, Warning } from "@phosphor-icons/react";
import { useId, type RefObject } from "react";
import { formatLocalDate } from "@/shared/lib/local-date";
import { formatYen } from "@/shared/lib/yen";
import { Field } from "@/shared/ui/field";
import { Segmented, type SegmentedOption } from "@/shared/ui/segmented";
import type { Participant } from "../api/payments-api";
import {
  burdensOf,
  paymentAmountFromInput,
  percentFromInput,
  shareNoteOf,
  slot0PercentOf,
  type PaymentFormErrors,
  type PaymentFormField,
  type PaymentFormValues,
  type PaymentSplitMode,
} from "../model/payment-form";

export type PaymentFormChange =
  | { field: "amount" | "myPercent" | "label"; value: string }
  | { field: "payerUserId"; value: string }
  | { field: "mode"; value: PaymentSplitMode };

/** 「関連する予定」欄の表示状態。getPlan の確認が要る間だけ pending/failed になる。 */
export type PlanRowState = "ready" | "pending" | "failed";

const SPLIT_OPTIONS: SegmentedOption[] = [
  { value: "half", label: "折半" },
  { value: "payer-all", label: "払った人が全額" },
  { value: "other-all", label: "もう一人が全額" },
  { value: "ratio", label: "割合を指定" },
];

function Avatar({ name, mine }: { name: string; mine: boolean }) {
  return (
    <span
      className={mine ? "pay-avatar pay-avatar-me" : "pay-avatar"}
      aria-hidden="true"
    >
      {Array.from(name)[0] ?? ""}
    </span>
  );
}

/**
 * 支払いを記録の入力欄。金額・払った人・負担の分け方・二人の負担
 * （入力のたびにサーバーと同じ式で計算して見せる）・用途・関連する予定。
 * 固定するときは欄全体を固定する（送信中・結果不明・保留の確認のあいだ）。
 */
export function PaymentFormFields({
  values,
  errors,
  locked = false,
  participants,
  meUserId,
  planRowState = "ready",
  fieldRefs,
  onChange,
  onOpenPlanPicker,
  onPlanRetry,
  onPlanClear,
}: {
  values: PaymentFormValues;
  errors: PaymentFormErrors;
  /** 送信中・結果不明・保留の確認のあいだは欄全体を固定する。 */
  locked?: boolean;
  /** 参加者二人（残額の応答の participants）。 */
  participants: readonly Participant[];
  meUserId: string;
  planRowState?: PlanRowState;
  fieldRefs?: Partial<
    Record<PaymentFormField, RefObject<HTMLInputElement | null>>
  >;
  onChange: (change: PaymentFormChange) => void;
  onOpenPlanPicker: () => void;
  /** URL の予定の確認に失敗したときの再取得と解除。 */
  onPlanRetry: () => void;
  onPlanClear: () => void;
}) {
  const amountId = useId();
  const me = participants.find((p) => p.userId === meUserId);
  const payer = participants.find((p) => p.userId === values.payerUserId);
  const slot0 = participants.find((p) => p.slot === 0);
  const slot1 = participants.find((p) => p.slot === 1);
  const ordered =
    slot0 !== undefined && slot1 !== undefined ? [slot0, slot1] : [];

  const amount = paymentAmountFromInput(values.amount);
  const myPercent = percentFromInput(values.myPercent);
  const slot0Percent =
    payer !== undefined && me !== undefined
      ? values.mode === "ratio" && myPercent === null
        ? null
        : slot0PercentOf(values.mode, payer, me, myPercent ?? 0)
      : null;
  const burdens =
    amount !== null && slot0Percent !== null && payer !== undefined
      ? burdensOf(amount, slot0Percent, payer)
      : null;
  const shareNote = shareNoteOf(values.mode);

  const payerOptions: SegmentedOption[] = participants.map((p) => ({
    value: p.userId,
    label:
      p.userId === meUserId ? `${p.displayName}（自分）` : p.displayName,
    icon: <Avatar name={p.displayName} mine={p.userId === meUserId} />,
  }));

  return (
    <div className="trip-form">
      <div className="field">
        <label className="field-label" htmlFor={amountId}>
          金額
        </label>
        <div className="pay-amount">
          <input
            id={amountId}
            type="text"
            inputMode="numeric"
            className="pay-amount-input tabular-nums"
            value={values.amount}
            readOnly={locked}
            aria-disabled={locked || undefined}
            aria-invalid={errors.amount !== undefined ? true : undefined}
            ref={fieldRefs?.amount}
            onChange={(event) =>
              onChange({ field: "amount", value: event.target.value })
            }
          />
          <span className="pay-amount-unit" aria-hidden="true">
            円
          </span>
        </div>
        {errors.amount !== undefined && (
          <p className="field-error" role="alert">
            {errors.amount}
          </p>
        )}
      </div>

      <div className="field">
        <Segmented
          label="払った人"
          options={payerOptions}
          value={values.payerUserId}
          onChange={(userId) =>
            onChange({ field: "payerUserId", value: userId })
          }
          columns={2}
          locked={locked}
        />
      </div>

      <div className="field">
        <Segmented
          label="負担の分け方"
          options={SPLIT_OPTIONS}
          value={values.mode}
          onChange={(mode) =>
            onChange({ field: "mode", value: mode as PaymentSplitMode })
          }
          columns={2}
          locked={locked}
        />
      </div>

      <div className="field">
        <span className="field-label">二人の負担</span>
        <div className="pay-share">
          {ordered.map((participant) => {
            const isMe = participant.userId === meUserId;
            const isPayer = payer?.userId === participant.userId;
            const percent =
              slot0Percent === null
                ? null
                : participant.slot === 0
                  ? slot0Percent
                  : 100 - slot0Percent;
            const burden =
              burdens === null
                ? null
                : participant.slot === 0
                  ? burdens.slot0
                  : burdens.slot1;
            const editablePercent = values.mode === "ratio" && isMe;
            return (
              <div className="pay-share-row" key={participant.userId}>
                <Avatar name={participant.displayName} mine={isMe} />
                <span className="pay-share-name">
                  {participant.displayName}
                </span>
                {isMe && <span className="pay-share-tag">自分</span>}
                {isPayer && (
                  <span className="pay-share-tag pay-share-tag-payer">
                    払った人
                  </span>
                )}
                {editablePercent && !locked ? (
                  <span className="pay-share-percent-edit">
                    <input
                      type="text"
                      inputMode="numeric"
                      aria-label="自分の負担の割合"
                      className="pay-share-percent-input tabular-nums"
                      value={values.myPercent}
                      readOnly={locked}
                      aria-invalid={
                        errors.myPercent !== undefined ? true : undefined
                      }
                      ref={fieldRefs?.myPercent}
                      onChange={(event) =>
                        onChange({
                          field: "myPercent",
                          value: event.target.value,
                        })
                      }
                    />
                    <span aria-hidden="true">%</span>
                  </span>
                ) : (
                  <span className="pay-share-percent tabular-nums">
                    {percent === null ? "—" : `${percent}%`}
                  </span>
                )}
                <span className="pay-share-yen tabular-nums">
                  {burden === null ? "—" : formatYen(burden)}
                </span>
              </div>
            );
          })}
        </div>
        {errors.myPercent !== undefined && (
          <p className="field-error" role="alert">
            {errors.myPercent}
          </p>
        )}
        {shareNote !== null && <p className="pay-share-note">{shareNote}</p>}
      </div>

      <Field
        label="用途"
        optional
        value={values.label}
        onChange={(event) =>
          onChange({ field: "label", value: event.target.value })
        }
        error={errors.label ?? null}
        locked={locked}
        ref={fieldRefs?.label}
        autoComplete="off"
      />

      <div className="field">
        <span className="field-label">
          関連する予定
          <span className="field-optional">任意</span>
        </span>
        {planRowState === "failed" ? (
          <div className="pay-plan-failed">
            <p className="field-error" role="alert">
              <Warning size={15} weight="bold" aria-hidden="true" />
              関連する予定を確認できませんでした
            </p>
            <div className="pay-plan-failed-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={onPlanRetry}
              >
                再取得する
              </button>
              {!locked && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={onPlanClear}
                >
                  関連付けを解除する
                </button>
              )}
            </div>
          </div>
        ) : locked ? (
          <div className="pay-plan-row pay-plan-row-locked">
            <span className="pay-plan-text">
              {values.plan === null
                ? "選択しない"
                : `${formatLocalDate(values.plan.date)} · ${values.plan.name}`}
            </span>
          </div>
        ) : (
          <button
            type="button"
            className="pay-plan-row"
            onClick={onOpenPlanPicker}
          >
            <span className="pay-plan-text">
              {values.plan === null
                ? "選択しない"
                : `${formatLocalDate(values.plan.date)} · ${values.plan.name}`}
            </span>
            <CaretRight size={16} weight="bold" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}
