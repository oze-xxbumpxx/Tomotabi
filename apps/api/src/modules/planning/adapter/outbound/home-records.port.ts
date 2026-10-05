import type { TimelineItem } from "@tomotabi/contracts";
import type { HomeRosterEntry } from "./home-read.port";

export const HOME_RECORDS_FACTORY = Symbol("HOME_RECORDS_FACTORY");

/**
 * ホームの「最近の記録」の欄の照会。記録の一覧の読み取りを再利用し、
 * 新しい順に最大3件を返す（F-40）。戻り値は種類ごとの中身を
 * 組み立て済みの契約の形。
 * 実装はrecord側が持ち、compositionがtxのdbハンドルから組み立てて
 * 注入する。ホームのトランザクションでは欄の中のクエリも順に実行する
 * （一覧の中身を読む3クエリをPromise.allで並べない）。
 */
export interface HomeRecordsPort {
  listRecent(
    tripId: string,
    roster: readonly HomeRosterEntry[],
  ): Promise<readonly TimelineItem[]>;
}

/**
 * UoWのトランザクションのdbハンドルからポートを組み立てる組み立て関数。
 * dbはpgのトランザクション。型を漏らさないためunknownで受ける。
 */
export type HomeRecordsFactory = (db: unknown) => HomeRecordsPort;
