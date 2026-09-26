import type { Me } from "@tomotabi/contracts";
import type { UserId } from "../../../../common/domain/user-id";

export const GET_ME_INPUT_PORT = Symbol("GET_ME_INPUT_PORT");

export interface GetMeInputPort {
  /**
   * 利用者が見つからないときは null を返す。
   */
  execute(userId: UserId, sessionExpiresAt: Date): Promise<Me | null>;
}
