import type { BalanceSummary } from "@tomotabi/contracts";
import type { HomeRosterEntry } from "./home-read.port";

export const HOME_BALANCE_FACTORY = Symbol("HOME_BALANCE_FACTORY");

/**
 * ホームの「精算」の欄の照会。settlementの残額の計算をそのまま使い、
 * 受け渡しの向き・金額と次回の対象の件数を返す（F-47）。
 * 実装はsettlement側が持ち、compositionがtxのdbハンドルから組み立てて
 * 注入する。ホーム専用の金額の計算式は作らない。
 */
export interface HomeBalancePort {
  findSummary(
    tripId: string,
    roster: readonly HomeRosterEntry[],
  ): Promise<BalanceSummary>;
}

/**
 * UoWのトランザクションのdbハンドルからポートを組み立てる組み立て関数。
 * dbはpgのトランザクション。型を漏らさないためunknownで受ける。
 */
export type HomeBalanceFactory = (db: unknown) => HomeBalancePort;
