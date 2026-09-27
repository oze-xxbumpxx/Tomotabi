import type { Trip } from "./trip";

export type PlanKind = "place" | "food" | "shopping" | "lodging" | "transport";

export type EventKind = "achievement" | "booking";

export type Cancellation = {
  targetId: string;
  cancelledBy: string;
  createdAt: string;
};

export type PlanEvent = {
  id: string;
  tripId: string;
  planId: string;
  kind: EventKind;
  createdBy: string;
  createdAt: string;
  cancellation: Cancellation | null;
};

export type Plan = {
  id: string;
  tripId: string;
  name: string;
  kind: PlanKind;
  date: string;
  time: string | null;
  memo: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  version: string;
  achievement: PlanEvent | null;
  booking: PlanEvent | null;
  canChangeKind: boolean;
  kindChangeReason: "record_history_exists" | null;
};

export type PlanCreate = {
  name: string;
  kind: PlanKind;
  date: string;
  time?: string | null;
  memo?: string | null;
};

export type PlanPatch = {
  name?: string;
  kind?: PlanKind;
  time?: string | null;
  memo?: string | null;
};

export type Move = {
  date: string;
};

export type Period = {
  startsOn: string;
  endsOn: string;
};

export type Itinerary = {
  trip: Trip;
  date: string;
  plans: Plan[];
  fetchedAt: string;
};
