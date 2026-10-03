export type TripStatus = "planning" | "traveling" | "finished";

export type Trip = {
  id: string;
  name: string;
  /** `YYYY-MM-DD`。startsOn ≤ endsOnで、期間は両端の日を含む。 */
  startsOn: string;
  /** `YYYY-MM-DD`。 */
  endsOn: string;
  status: TripStatus;
  /**
   * 10進の正整数の文字列。単一の強いETagの中身で、If-Matchには`"3"`の
   * 引用付きで渡す。変化のたびに1増え、同じ状態への遷移や同じ値への
   * 変更では増えない。
   */
  version: string;
  /** ISO 8601の日時。 */
  createdAt: string;
  /** ISO 8601の日時。statusがplanningの間はnull。 */
  startedAt: string | null;
  /** ISO 8601の日時。statusがfinishedのときだけ値を持つ。 */
  finishedAt: string | null;
  createdBy: string;
  startedBy: string | null;
  finishedBy: string | null;
};

export type TripCreate = {
  name: string;
  /** `YYYY-MM-DD`。 */
  startsOn: string;
  /** `YYYY-MM-DD`。 */
  endsOn: string;
};

export type TripRename = {
  name: string;
};

export type TripPage = {
  items: Trip[];
  /** 続きがあるときの不透明なカーソル。無ければnull。 */
  nextCursor: string | null;
};
