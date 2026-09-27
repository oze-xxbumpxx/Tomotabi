import type { BoundedText } from "../../../common/domain/bounded-text";
import type { UserId } from "../../../common/domain/user-id";
import { TripPeriod } from "./trip-period";

export type TripStatus = "planning" | "traveling" | "finished";

/**
 * 旅行。version は ETag / If-Match と対応する正の整数（wire では 10 進の文字列）。
 * 状態は planning → traveling → finished で、戻す遷移は存在しない。
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
 * 許可されない状態遷移。UseCase が 409 INVALID_TRIP_TRANSITION に写す。
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
   * planning → traveling。既に traveling のときは変化なしのまま返す。
   * 同じ状態への遷移で version・日時を変えないのは、ETag が一致する別キーの要求を
   * 「既に目的の状態」として扱うため（B-07。version を増やすとその後の再送が
   * VERSION_CONFLICT になる）。
   * @throws finished からの遷移は InvalidTripTransitionError。
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
   * traveling → finished。既に finished のときは変化なしのまま返す（B-07）。
   * @throws planning からの遷移は InvalidTripTransitionError。
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
