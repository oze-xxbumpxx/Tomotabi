import type { TimelineItem } from "@tomotabi/contracts";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { HomeRosterEntry } from "../../planning/adapter/outbound/home-read.port";
import type { HomeRecordsPort } from "../../planning/adapter/outbound/home-records.port";
import type { TripRosterEntry } from "../adapter/outbound/finance-work-context";
import { joinTimelineItems } from "../usecase/records-dto";
import { PgRecordsRead } from "./pg-records-read";

/** ホームの「最近の記録」で組み立てたい最大件数（F-40）。 */
const HOME_RECENT_RECORDS_LIMIT = 3;

/**
 * ホームの「最近の記録」の欄の照会。記録の一覧の読み取りを
 * そのまま使い、新しい順の最大3件を返す。
 * 一覧の一覧化（中身を読むクエリをPromise.allで並べる）とは違い、
 * ホームのトランザクションでは同じ接続にクエリを並べられないため
 * 順に実行する。
 */
export class PgHomeRecordsRead implements HomeRecordsPort {
  private readonly records: PgRecordsRead;

  constructor(db: NodePgDatabase) {
    this.records = new PgRecordsRead(db);
  }

  async listRecent(
    tripId: string,
    roster: readonly HomeRosterEntry[],
  ): Promise<readonly TimelineItem[]> {
    const page = await this.records.listTimeline(tripId, {
      type: null,
      planId: null,
      recordId: null,
      after: null,
      limit: HOME_RECENT_RECORDS_LIMIT,
    });
    const paymentIds = page.items
      .filter((row) => row.kind === "payment")
      .map((row) => row.id);
    const eventIds = page.items
      .filter((row) => row.kind === "achievement" || row.kind === "booking")
      .map((row) => row.id);
    const payments = await this.records.listPaymentsByIds(tripId, paymentIds);
    const paymentCancellations =
      await this.records.listPaymentCancellationsByIds(tripId, paymentIds);
    const planEventCancellations =
      await this.records.listPlanEventCancellationsByIds(tripId, eventIds);
    return joinTimelineItems({
      rows: page.items,
      // HomeRosterEntryはTripRosterEntryと同じ形（planningがrecordの型を
      // 参照しないため別名で宣言している）。ここで組み立て直して渡す。
      roster: roster.map(
        (entry): TripRosterEntry => ({
          slot: entry.slot,
          userId: entry.userId,
          displayName: entry.displayName,
        }),
      ),
      payments,
      paymentCancellations,
      planEventCancellations,
    });
  }
}
