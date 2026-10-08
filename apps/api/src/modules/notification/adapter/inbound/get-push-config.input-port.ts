import type { z as zod } from "zod";
import type { GetPushConfigResponse } from "../../../../generated/notifications.zod";

export const GET_PUSH_CONFIG_INPUT_PORT = Symbol(
  "GET_PUSH_CONFIG_INPUT_PORT",
);

export type PushConfig = zod.infer<typeof GetPushConfigResponse>;

/**
 * クライアントがPush APIに登録するために必要な公開情報を返す。
 * 鍵の設定が無い・崩れているときは503 PUSH_UNAVAILABLE。
 */
export interface GetPushConfigInputPort {
  execute(): Promise<PushConfig>;
}
