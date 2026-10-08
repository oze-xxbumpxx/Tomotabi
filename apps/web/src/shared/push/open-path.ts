import type { PushPayload } from "@tomotabi/contracts";

/** 中身が確かめられなかったときに開く先（旅行一覧）。 */
export const FALLBACK_OPEN_PATH = "/trips";

/**
 * 通知を押したときに開くパス（PU-12）。種類とIDから決まったパスだけを
 * 組み立てる。中身にURLは入れない。取り消しの通知も同じ形で、
 * payloadのtargetIdが元の記録・精算のIDなのでそのまま使う（F-51）。
 */
export function openPathForPushPayload(payload: PushPayload): string {
  const { targetKind, tripId, targetId } = payload;
  switch (targetKind) {
    case "plan":
      return `/trips/${tripId}/plans/${targetId}`;
    case "achievement":
    case "booking":
    case "payment":
      return `/trips/${tripId}/records?recordType=${targetKind}&recordId=${targetId}`;
    case "settlement":
      return `/trips/${tripId}/settlement?settlementId=${targetId}`;
  }
}
