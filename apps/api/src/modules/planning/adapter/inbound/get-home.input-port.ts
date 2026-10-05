import type { Home } from "@tomotabi/contracts";
import type { UserId } from "../../../../common/domain/user-id";

export const GET_HOME_INPUT_PORT = Symbol("GET_HOME_INPUT_PORT");

export type GetHomeInput = Readonly<{
  userId: UserId;
  tripId: string;
}>;

export interface GetHomeInputPort {
  /**
   * @throws 旅行が無い・参加していないとき403 TRIP_NOT_ACCESSIBLE。
   *   欄の読み取りのうち回復できない誤り（接続が切れた・認証の失敗）は
   *   503 TEMPORARILY_UNAVAILABLE。
   */
  execute(input: GetHomeInput): Promise<Home>;
}
