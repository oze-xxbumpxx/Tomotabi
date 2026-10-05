import type {
  Cancellation,
  Event,
  Payment,
  TimelineItem,
  TimelineItemKind,
} from "../api/records-api";

/**
 * 記録の一覧の行の表示を決める純粋な組み立て。
 * 名前の解決（予定・支払いの問い合わせ）はui側のhookで行い、
 * ここでは値が渡された後の形を作るだけにする。
 */

/** 取り消しの行に対応する元の記録の種類。 */
export type RecordBaseKind = "achievement" | "booking" | "payment";

const CANCELLATION_BASE_KIND: Readonly<
  Record<TimelineItemKind, RecordBaseKind | null>
> = {
  achievement: null,
  booking: null,
  payment: null,
  achievement_cancellation: "achievement",
  booking_cancellation: "booking",
  payment_cancellation: "payment",
};

/** 取り消しの行の元の記録の種類。元の記録の行ならnull。 */
export function baseKindOf(
  kind: TimelineItemKind,
): RecordBaseKind | null {
  return CANCELLATION_BASE_KIND[kind];
}

/** 種類の短い表示名（小さな詳細・確認の文に使う）。 */
export function baseKindLabelOf(kind: RecordBaseKind): string {
  switch (kind) {
    case "achievement":
      return "達成";
    case "booking":
      return "予約";
    case "payment":
      return "支払い";
  }
}

/** 記録の行の詳細を種類ごとに取り出す（型の絞り込み用）。 */
export function eventOf(item: TimelineItem): Event | null {
  return item.kind === "achievement" || item.kind === "booking"
    ? (item.detail as Event)
    : null;
}

export function paymentOf(item: TimelineItem): Payment | null {
  return item.kind === "payment" ? (item.detail as Payment) : null;
}

export function cancellationOf(item: TimelineItem): Cancellation | null {
  return baseKindOf(item.kind) !== null
    ? (item.detail as Cancellation)
    : null;
}

/** その記録が取り消し済みならtrue（元の行の線消し・「取り消し済み」用）。 */
export function isVoided(item: TimelineItem): boolean {
  const event = eventOf(item);
  if (event !== null) {
    return event.cancellation !== null;
  }
  const payment = paymentOf(item);
  if (payment !== null) {
    return payment.cancellation !== null;
  }
  return false;
}

/** 記録の種類が`type`と同じ行か（「この記録に絞り込み」で元の記録を選ぶ）。 */
export function isOriginalOf(
  item: TimelineItem,
  type: RecordBaseKind,
): boolean {
  return item.kind === type;
}

/** `YYYY-MM-DD`（端末のローカル日）をISO日時から取る。日ごとの見出しに使う。 */
export function dayKeyOf(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** ISO日時の時刻を`9:20`の形にする（端末のローカル時刻）。 */
export function timeOfDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return `${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** 表示名の解決に渡す参加者の形（支払いのParticipantと同じ構造）。 */
export type RecordActor = { userId: string; displayName: string };

/** 記録した人の表示名。参加者に居なければ自分の名前、どちらも無ければ空。 */
export function actorNameOf(
  actorId: string,
  participants: readonly RecordActor[] | undefined,
  meUserId: string | null,
  meName: string | null,
): string {
  const participant = participants?.find((p) => p.userId === actorId);
  if (participant !== undefined) {
    return participant.displayName;
  }
  if (actorId === meUserId && meName !== null) {
    return meName;
  }
  return "";
}

/**
 * 支払いの負担の分け方の短い表示（「折半」「割合」「〇〇が全額」）。
 * 名前が取れないときは「割合」に畳む。
 */
export function shareNoteOfPayment(
  payment: Payment,
  nameOf: (userId: string) => string,
): string {
  const percents = payment.allocations.map((a) => a.percent);
  if (percents.every((p) => p === 50)) {
    return "折半";
  }
  const payer = payment.allocations.find(
    (a) => a.userId === payment.payerUserId,
  );
  const other = payment.allocations.find(
    (a) => a.userId !== payment.payerUserId,
  );
  if (payer?.percent === 100) {
    const name = nameOf(payment.payerUserId);
    return name !== "" ? `${name}が全額` : "割合";
  }
  if (other?.percent === 100) {
    const name = nameOf(other.userId);
    return name !== "" ? `${name}が全額` : "割合";
  }
  return "割合";
}
