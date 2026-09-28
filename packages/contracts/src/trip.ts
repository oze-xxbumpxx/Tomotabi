export type TripStatus = "planning" | "traveling" | "finished";

export type Trip = {
  id: string;
  name: string;
  /** `YYYY-MM-DD`。startsOn ≤ endsOn で、期間は両端の日を含む。 */
  startsOn: string;
  /** `YYYY-MM-DD`。 */
  endsOn: string;
  status: TripStatus;
  /**
   * 10 進の正整数の文字列。単一の強い ETag の中身で、If-Match には `"3"` の
   * 引用付きで渡す。変化のたびに 1 増え、同じ状態への遷移や同じ値への
   * 変更では増えない。
   */
  version: string;
  /** ISO 8601 の日時。 */
  createdAt: string;
  /** ISO 8601 の日時。status が planning の間は null。 */
  startedAt: string | null;
  /** ISO 8601 の日時。status が finished のときだけ値を持つ。 */
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
  /** 続きがあるときの不透明なカーソル。無ければ null。 */
  nextCursor: string | null;
};
