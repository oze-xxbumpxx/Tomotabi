import type { BoundedText } from "../../../common/domain/bounded-text";
import type { UserId } from "../../../common/domain/user-id";
import { TripPeriod } from "./trip-period";

export type TripStatus = "planning" | "traveling" | "finished";

/**
 * 旅行。versionはETag / If-Matchと対応する正の整数（wireでは10進の文字列）。
 * 状態はplanning → traveling → finishedで、戻す遷移は存在しない。
 */
export type Trip = Readonly<{
  id: string;
  name: BoundedText;
  period: TripPeriod;
  status: TripStatus;
  version: number;
  createdBy: UserId;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  startedBy: UserId | null;
  finishedAt: Date | null;
  finishedBy: UserId | null;
}>;

/**
 * 許可されない状態遷移。UseCaseが409 INVALID_TRIP_TRANSITIONに写す。
 */
export class InvalidTripTransitionError extends Error {
  constructor(
    readonly from: TripStatus,
    readonly operation: "start" | "finish",
  ) {
    super(`cannot ${operation} a ${from} trip`);
    this.name = "InvalidTripTransitionError";
  }
}

function bumped(trip: Trip, at: Date, patch: Partial<Trip>): Trip {
  return { ...trip, ...patch, version: trip.version + 1, updatedAt: at };
}

export const Trip = {
  rename(trip: Trip, name: BoundedText, at: Date): Trip {
    if (trip.name === name) {
      return trip;
    }
    return bumped(trip, at, { name });
  },

  changePeriod(trip: Trip, period: TripPeriod, at: Date): Trip {
    if (
      trip.period.startsOn === period.startsOn &&
      trip.period.endsOn === period.endsOn
    ) {
      return trip;
    }
    return bumped(trip, at, { period });
  },

  /**
   * planning → traveling。既にtravelingのときは変化なしのまま返す。
   * 同じ状態への遷移でversion・日時を変えないのは、ETagが一致する別キーの要求を
   * 「既に目的の状態」として扱うため（B-07。versionを増やすとその後の再送が
   * VERSION_CONFLICTになる）。
   * @throws finishedからの遷移はInvalidTripTransitionError。
   */
  start(trip: Trip, at: Date, by: UserId): Trip {
    if (trip.status === "traveling") {
      return trip;
    }
    if (trip.status !== "planning") {
      throw new InvalidTripTransitionError(trip.status, "start");
    }
    return bumped(trip, at, {
      status: "traveling",
      startedAt: at,
      startedBy: by,
    });
  },

  /**
   * traveling → finished。既にfinishedのときは変化なしのまま返す（B-07）。
   * @throws planningからの遷移はInvalidTripTransitionError。
   */
  finish(trip: Trip, at: Date, by: UserId): Trip {
    if (trip.status === "finished") {
      return trip;
    }
    if (trip.status !== "traveling") {
      throw new InvalidTripTransitionError(trip.status, "finish");
    }
    return bumped(trip, at, {
      status: "finished",
      finishedAt: at,
      finishedBy: by,
    });
  },
};
