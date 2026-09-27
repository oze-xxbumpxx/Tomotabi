import type { TripPage } from "@tomotabi/contracts";
import {
  type ListTripsInput,
  type ListTripsInputPort,
} from "../adapter/inbound/list-trips.input-port";
import type { PlanningReadPort } from "../adapter/outbound/planning-read.port";
import {
  decodeTripCursor,
  encodeTripCursor,
  invalidTripCursor,
} from "./trip-cursor";
import { toTripDto } from "./trip-dto";

export class ListTripsUseCase implements ListTripsInputPort {
  constructor(private readonly read: PlanningReadPort) {}

  async execute(input: ListTripsInput): Promise<TripPage> {
    const cursor =
      input.cursor === null ? null : decodeTripCursor(input.cursor);
    // カーソルの起点を DB の値で解決する。参加しない・存在しない旅行の id
    // は区別せず同じ 400 にする（存在を漏らさない）。
    const after =
      cursor === null
        ? null
        : await this.read.findTripAnchor(cursor.id, input.userId);
    if (cursor !== null && after === null) {
      throw invalidTripCursor();
    }
    const page = await this.read.listTripsForParticipant(input.userId, {
      status: input.status,
      after,
      limit: input.limit,
    });
    return {
      items: page.items.map(toTripDto),
      nextCursor:
        page.nextCursor === null ? null : encodeTripCursor(page.nextCursor),
    };
  }
}
