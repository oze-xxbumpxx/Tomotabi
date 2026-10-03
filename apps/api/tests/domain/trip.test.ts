import { describe, expect, it } from "vitest";
import { BoundedText } from "../../src/common/domain/bounded-text";
import { LocalDate } from "../../src/common/domain/local-date";
import { UserId } from "../../src/common/domain/user-id";
import { InvalidTripTransitionError, Trip } from "../../src/modules/planning/domain/trip";
import { TripPeriod } from "../../src/modules/planning/domain/trip-period";

const OWNER = UserId.parse("00000000-0000-4000-8000-000000000001");
const ACTOR = UserId.parse("00000000-0000-4000-8000-000000000002");
const T0 = new Date("2026-09-01T00:00:00.000Z");
const T1 = new Date("2026-09-10T09:00:00.000Z");
const T2 = new Date("2026-09-12T18:00:00.000Z");

function baseTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: "99999999-9999-4999-8999-999999999999",
    name: BoundedText.parse("京都 2 泊", 100),
    period: TripPeriod.create(
      LocalDate.parse("2026-09-10"),
      LocalDate.parse("2026-09-12"),
    ),
    status: "planning",
    version: 1,
    createdBy: OWNER,
    createdAt: T0,
    updatedAt: T0,
    startedAt: null,
    startedBy: null,
    finishedAt: null,
    finishedBy: null,
    ...overrides,
  };
}

// U-08: Tripの状態遷移（F-08、E-14、B-07）
describe("Trip の状態遷移", () => {
  it("planning → traveling は version・started_at・started_by・updated_at を更新する", () => {
    const started = Trip.start(baseTrip(), T1, ACTOR);
    expect(started).toMatchObject({
      status: "traveling",
      version: 2,
      startedAt: T1,
      startedBy: ACTOR,
      updatedAt: T1,
      finishedAt: null,
      finishedBy: null,
    });
  });

  it("traveling → finished は version・finished_at・finished_by・updated_at を更新する", () => {
    const traveling = Trip.start(baseTrip(), T1, ACTOR);
    const finished = Trip.finish(traveling, T2, OWNER);
    expect(finished).toMatchObject({
      status: "finished",
      version: 3,
      startedAt: T1,
      startedBy: ACTOR,
      finishedAt: T2,
      finishedBy: OWNER,
      updatedAt: T2,
    });
  });

  it("finished → start は InvalidTripTransitionError", () => {
    const finished = Trip.finish(Trip.start(baseTrip(), T1, ACTOR), T2, OWNER);
    expect(() => Trip.start(finished, T2, ACTOR)).toThrow(
      InvalidTripTransitionError,
    );
  });

  it("planning → finish は InvalidTripTransitionError", () => {
    expect(() => Trip.finish(baseTrip(), T1, ACTOR)).toThrow(
      InvalidTripTransitionError,
    );
  });

  it("traveling で start は変化なし（version・started_at・updated_at 不変）", () => {
    const traveling = Trip.start(baseTrip(), T1, ACTOR);
    const again = Trip.start(traveling, T2, OWNER);
    expect(again).toBe(traveling);
    expect(again.version).toBe(1 + 1);
    expect(again.startedAt).toEqual(T1);
    expect(again.startedBy).toBe(ACTOR);
  });

  it("finished で finish は変化なし", () => {
    const finished = Trip.finish(Trip.start(baseTrip(), T1, ACTOR), T2, OWNER);
    expect(Trip.finish(finished, new Date(), ACTOR)).toBe(finished);
  });
});

describe("Trip の名前・期間の変更", () => {
  it("rename は version を 1 増やし updatedAt を進める", () => {
    const renamed = Trip.rename(
      baseTrip(),
      BoundedText.parse("沖縄 3 泊", 100),
      T1,
    );
    expect(renamed.name).toBe("沖縄 3 泊");
    expect(renamed.version).toBe(2);
    expect(renamed.updatedAt).toEqual(T1);
    expect(renamed.status).toBe("planning");
  });

  it("同じ名前への rename は変化なし（同一オブジェクト）", () => {
    const trip = baseTrip();
    expect(Trip.rename(trip, trip.name, T1)).toBe(trip);
  });

  it("changePeriod は version を 1 増やす", () => {
    const changed = Trip.changePeriod(
      baseTrip(),
      TripPeriod.create(LocalDate.parse("2026-09-11"), LocalDate.parse("2026-09-13")),
      T1,
    );
    expect(changed.period.startsOn).toBe("2026-09-11");
    expect(changed.version).toBe(2);
  });

  it("同じ期間への changePeriod は変化なし（同一オブジェクト）", () => {
    const trip = baseTrip();
    expect(Trip.changePeriod(trip, trip.period, T1)).toBe(trip);
  });

  it("finished の旅行でも名前・期間は変更できる", () => {
    const finished = Trip.finish(Trip.start(baseTrip(), T1, ACTOR), T2, OWNER);
    const renamed = Trip.rename(finished, BoundedText.parse("思い出", 100), T2);
    expect(renamed.status).toBe("finished");
    expect(renamed.version).toBe(4);
  });
});
