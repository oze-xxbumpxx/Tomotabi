/**
 * 二人の名前が並ぶ所で、相手の名前の後ろに付ける小さな印「（相手）」
 * （設計書`docs/designs/first-use-decisions.md`の「相手の名前」）。
 * 自分のユーザーIDと比べて、自分でなければ出す。名前が参加者の一覧から
 * 取れず「相手」と出すところには付けない（「相手（相手）」にしない）。
 * 読み上げでも名前と一緒に読むので、`aria-hidden`にはしない。
 */
export function PartnerTag({
  userId,
  meUserId,
  participants,
}: {
  userId: string | null;
  meUserId: string | null;
  participants: readonly { userId: string }[] | null | undefined;
}) {
  const isKnownPartner =
    userId !== null &&
    meUserId !== null &&
    userId !== meUserId &&
    (participants?.some((p) => p.userId === userId) ?? false);
  if (!isKnownPartner) {
    return null;
  }
  return <span className="partner-tag">（相手）</span>;
}
