export type TripStatus = "planning" | "traveling" | "finished";

export type Trip = {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string;
  status: TripStatus;
  version: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  createdBy: string;
  startedBy: string | null;
  finishedBy: string | null;
};

export type TripCreate = {
  name: string;
  startsOn: string;
  endsOn: string;
};

export type TripRename = {
  name: string;
};

export type TripPage = {
  items: Trip[];
  nextCursor: string | null;
};
