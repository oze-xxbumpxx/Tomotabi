/** 参加者の丸い顔アイコン（名前の頭文字。参加者番号で色を分ける）。 */
export function PersonAvatar({
  name,
  slot,
}: {
  name: string;
  slot: number | null;
}) {
  const variant =
    slot === 0
      ? "settle-avatar-first"
      : slot === 1
        ? "settle-avatar-second"
        : "settle-avatar-plain";
  return (
    <span className={`settle-avatar ${variant}`} aria-hidden="true">
      {name.slice(0, 1)}
    </span>
  );
}
