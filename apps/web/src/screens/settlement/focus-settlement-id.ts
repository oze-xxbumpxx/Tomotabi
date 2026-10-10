import { isUuidString } from "@/shared/lib/uuid";

/**
 * 精算の画面の`?settlementId=`。通知から開いた1件を目立たせるための
 * 値の確かめ方（F-52）。UUIDの形のときだけその値を返し、配列なら
 * 先頭を見る。形が違えばnull（無視する）。
 */
export function parseFocusSettlementId(
  settlementId: string | string[] | null,
): string | null {
  const raw =
    typeof settlementId === "string" && settlementId !== ""
      ? settlementId
      : Array.isArray(settlementId) &&
          typeof settlementId[0] === "string" &&
          settlementId[0] !== ""
        ? settlementId[0]
        : null;
  return raw !== null && isUuidString(raw) ? raw : null;
}
