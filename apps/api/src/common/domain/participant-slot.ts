/**
 * 参加者番号。旅行の二人に振る固定の番号 0・1（DB の slot）。
 * 金額の向きの基準に使い、画面では「自分」「相手」に直して見せる。
 */
export type ParticipantSlot = 0 | 1;

export const ParticipantSlot = {
  /**
   * @throws 0・1 以外のとき Error を投げる。
   */
  parse(value: number): ParticipantSlot {
    if (value !== 0 && value !== 1) {
      throw new Error("ParticipantSlot must be 0 or 1");
    }
    return value;
  },

  /** もう一人の参加者番号を返す。 */
  counterpart(slot: ParticipantSlot): ParticipantSlot {
    return slot === 0 ? 1 : 0;
  },
};
