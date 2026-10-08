import type { VapidKeyState } from "./vapid-keyring";

/** 1人が同時に有効にできる購読の数（詳細設計・契約のmaxActiveSubscriptions）。 */
export const MAX_ACTIVE_PUSH_SUBSCRIPTIONS = 3;

/**
 * 購読のAPI応答の1項目。宛先と鍵は含まない（応答にもログにも出さない）。
 * updatedAtはISO文字列（契約のdate-time）。
 */
export type PushSubscriptionItem = Readonly<{
  id: string;
  deviceLabel: string;
  enabled: boolean;
  /** 登録したときのkeyIdが今の鍵の束でどの状態か。 */
  vapidKeyState: VapidKeyState;
  /** 今のセッションで登録した購読か。 */
  isCurrentSession: boolean;
  updatedAt: string;
}>;
