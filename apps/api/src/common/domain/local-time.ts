export type LocalTime = string & { readonly __brand: "LocalTime" };

// HH:mm（00:00〜23:59）だけ。秒・秒の端数は DB の time(0) が丸めてしまうため、
// API の境界でここだけが守る。
const LOCAL_TIME_PATTERN = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

export const LocalTime = {
  /**
   * @throws `HH:mm` でない（秒や秒の端数を含む・1 桁の時・24:00 以降）とき Error を投げる。
   */
  parse(value: string): LocalTime {
    if (!LOCAL_TIME_PATTERN.test(value)) {
      throw new Error("LocalTime must be HH:mm");
    }
    return value as LocalTime;
  },
};
