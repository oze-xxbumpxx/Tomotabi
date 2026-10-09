import type { PushActionTarget } from "@tomotabi/contracts";
import type { UserId } from "../../../common/domain/user-id";

/**
 * 保存のあとに渡す通知のイベント（設計書「保存のあとに送る流れ」）。
 * actionとtargetKindは契約で許可された11組だけ。追加と取り消しは別のイベント。
 */
export type NotificationEvent = PushActionTarget &
  Readonly<{
    /** 操作のID（新しいUUID）。同じ操作の重複は受け手が捨てる。 */
    eventId: string;
    /** 旅行のID。 */
    tripId: string;
    /** 対象のID。取り消しは元の記録・精算のID（F-51）。 */
    targetId: string;
    /** 操作した人。送る相手から除く。 */
    actorUserId: UserId;
    /** 操作の日時（ISO 8601）。 */
    occurredAt: string;
  }>;
