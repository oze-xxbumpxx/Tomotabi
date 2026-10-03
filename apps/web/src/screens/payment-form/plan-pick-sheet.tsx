"use client";

import { CalendarCheck, CheckCircle, Prohibit } from "@phosphor-icons/react";
import { useId, useState } from "react";
import { useTripItinerary } from "@/features/trips";
import { FetchFailed } from "@/shared/ui/state/fetch-failed";
import { Loading } from "@/shared/ui/state/loading";
import { Sheet } from "@/shared/ui/sheet";
import { DatePickerGrid } from "@/features/plans";
import type { SelectedPlan } from "@/features/payments";

/**
 * 関連する予定の選択シート（v3 11c）。期間の日を選ぶとその日の予定
 * （選んだ日のgetItinerary）が並び、先頭の「選択しない」か予定を
 * 選んで「この予定にする」で確定する。しおりの表示日と違う日の予定も選べる。
 */
export function PlanPickSheet({
  tripId,
  period,
  current,
  onPick,
  onClose,
}: {
  tripId: string;
  period: { startsOn: string; endsOn: string };
  /** いま選ばれている予定（いなければnull）。 */
  current: SelectedPlan | null;
  onPick: (plan: SelectedPlan | null) => void;
  onClose: () => void;
}) {
  const name = useId();
  const [date, setDate] = useState(current?.date ?? period.startsOn);
  const [picked, setPicked] = useState<SelectedPlan | null>(current);
  const itineraryQuery = useTripItinerary(tripId, date);
  const plans = itineraryQuery.data?.plans ?? [];

  return (
    <Sheet
      title="関連する予定"
      onClose={onClose}
      footer={
        <button
          type="button"
          className="btn-primary"
          onClick={() => onPick(picked)}
        >
          この予定にする
        </button>
      }
    >
      <div className="field">
        <DatePickerGrid
          startsOn={period.startsOn}
          endsOn={period.endsOn}
          value={date}
          onSelect={setDate}
        />
      </div>
      <div className="pay-plan-list" role="radiogroup" aria-label="予定">
        <label className="pay-plan-item">
          <input
            type="radio"
            className="pay-plan-radio"
            name={name}
            checked={picked === null}
            onChange={() => setPicked(null)}
          />
          <span className="pay-plan-item-main">
            <span className="pay-plan-item-name">選択しない</span>
          </span>
        </label>
        {itineraryQuery.isPending && <Loading />}
        {itineraryQuery.isError && (
          <FetchFailed
            message="その日の予定を取得できませんでした"
            onRetry={() => void itineraryQuery.refetch()}
          />
        )}
        {itineraryQuery.data !== undefined &&
          plans.map((plan) => (
            <label className="pay-plan-item" key={plan.id}>
              <input
                type="radio"
                className="pay-plan-radio"
                name={name}
                checked={picked?.id === plan.id}
                onChange={() =>
                  setPicked({ id: plan.id, date: plan.date, name: plan.name })
                }
              />
              <span className="pay-plan-item-main">
                <span className="pay-plan-item-time tabular-nums">
                  {plan.time ?? "時刻未定"}
                </span>
                <span className="pay-plan-item-name">{plan.name}</span>
                {plan.cancelledAt !== null && (
                  <span className="plan-badge plan-badge-cancelled">
                    <Prohibit size={13} weight="bold" aria-hidden="true" />
                    取りやめ
                  </span>
                )}
                {plan.achievement !== null && (
                  <span className="plan-badge plan-badge-achieved">
                    <CheckCircle size={13} weight="bold" aria-hidden="true" />
                    達成
                  </span>
                )}
                {plan.booking !== null && (
                  <span className="plan-badge plan-badge-booked">
                    <CalendarCheck size={13} weight="bold" aria-hidden="true" />
                    予約済み
                  </span>
                )}
              </span>
            </label>
          ))}
        {itineraryQuery.data !== undefined && plans.length === 0 && (
          <p className="pay-plan-empty">この日の予定はまだありません</p>
        )}
      </div>
    </Sheet>
  );
}
