"use client";

import { useQueries } from "@tanstack/react-query";
import { useId, useState } from "react";
import { getTripItinerary, itineraryQueryKey, useTrip } from "@/features/trips";
import { ApiRequestError } from "@/shared/api/api-failure";
import { daysOfPeriod, formatLocalDate } from "@/shared/lib/local-date";
import { FetchFailed } from "@/shared/ui/state/fetch-failed";
import { Loading } from "@/shared/ui/state/loading";
import { Sheet } from "@/shared/ui/sheet";

/**
 * ToDoと関連付ける予定を選ぶシート（todo-organize「予定を選ぶ」）。
 * 旅行の期間の全部の日のしおりを読み、取りやめていない予定を日付ごとに
 * 並べる。1つ選んで「決定」（関連付けがあるときは「予定を変更」）で確定する。
 */
export function TodoPlanPickSheet({
  tripId,
  currentPlanId,
  saving,
  closable,
  onPick,
  onClose,
}: {
  tripId: string;
  /** いま関連付いている予定。無ければnull。 */
  currentPlanId: string | null;
  /** 保存中。選び直しと確定を押せなくする。 */
  saving: boolean;
  closable: boolean;
  /** 決定。nullは「関連付けを外す」。 */
  onPick: (planId: string | null) => void;
  onClose: () => void;
}) {
  const name = useId();
  const trip = useTrip(tripId);
  const dates =
    trip.data === undefined
      ? []
      : daysOfPeriod(trip.data.startsOn, trip.data.endsOn);
  const [picked, setPicked] = useState<string | null>(currentPlanId);
  const itineraries = useQueries({
    queries: dates.map((date) => ({
      queryKey: itineraryQueryKey(tripId, date),
      queryFn: () =>
        getTripItinerary(tripId, date).match(
          (itinerary) => itinerary,
          (failure) => {
            throw new ApiRequestError(failure);
          },
        ),
    })),
  });
  const loading =
    trip.isPending || itineraries.some((result) => result.isPending);
  const failedIndex = itineraries.findIndex((result) => result.isError);
  const failed = trip.isError || failedIndex !== -1;
  const retry = () => {
    if (trip.isError) {
      void trip.refetch();
    }
    if (failedIndex !== -1) {
      void itineraries[failedIndex]?.refetch();
    }
  };
  const groups = dates
    .map((date, index) => ({
      date,
      plans: (itineraries[index]?.data?.plans ?? []).filter(
        (plan) => plan.cancelledAt === null,
      ),
    }))
    .filter((group) => group.plans.length > 0);

  return (
    <Sheet
      title="予定を選ぶ"
      onClose={onClose}
      closable={closable}
      footer={
        <div className="sheet-footer">
          {currentPlanId !== null && (
            <button
              type="button"
              className="btn-secondary"
              disabled={saving}
              onClick={() => onPick(null)}
            >
              関連付けを外す
            </button>
          )}
          <button
            type="button"
            className="btn-ink"
            disabled={saving || loading || failed}
            onClick={() => onPick(picked)}
          >
            {currentPlanId === null ? "決定" : "予定を変更"}
          </button>
        </div>
      }
    >
      {loading && <Loading />}
      {!loading && failed && (
        <FetchFailed
          message="旅行の予定を取得できませんでした"
          onRetry={retry}
        />
      )}
      {!loading && !failed && (
        <div className="pay-plan-list" role="radiogroup" aria-label="予定">
          {groups.map((group) => (
            <div key={group.date}>
              <p className="todo-meta">{formatLocalDate(group.date)}</p>
              {group.plans.map((plan) => (
                <label className="pay-plan-item" key={plan.id}>
                  <input
                    type="radio"
                    className="pay-plan-radio"
                    name={name}
                    checked={picked === plan.id}
                    onChange={() => setPicked(plan.id)}
                  />
                  <span className="pay-plan-item-main">
                    <span className="pay-plan-item-time tabular-nums">
                      {plan.time ?? "時刻未定"}
                    </span>
                    <span className="pay-plan-item-name">{plan.name}</span>
                  </span>
                </label>
              ))}
            </div>
          ))}
          {groups.length === 0 && (
            <p className="pay-plan-empty">この旅行の予定はまだありません</p>
          )}
        </div>
      )}
    </Sheet>
  );
}
