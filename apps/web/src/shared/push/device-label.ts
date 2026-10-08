/** User-Agentから端末名が作れないときの名前。 */
export const FALLBACK_DEVICE_LABEL = "この端末";

/** 契約のdeviceLabelの上限（PUT /api/me/push-subscriptionsのmaxLength 60）。 */
const DEVICE_LABEL_MAX_LENGTH = 60;

const DEVICES: ReadonlyArray<readonly [RegExp, string]> = [
  [/iPhone/, "iPhone"],
  [/iPad/, "iPad"],
  [/Android/, "Android"],
  [/Macintosh|Mac OS X/, "Mac"],
  [/Windows/, "Windows"],
];

// Edge・Firefox・ChromeはSafariより先に見る（Chrome系のUAにSafariが含まれるため）。
const BROWSERS: ReadonlyArray<readonly [RegExp, string]> = [
  [/EdgA\/|EdgiOS\/|Edg\/|Edge\//, "Edge"],
  [/FxiOS\/|Firefox\//, "Firefox"],
  [/CriOS\/|Chrome\//, "Chrome"],
  [/Safari\//, "Safari"],
];

function detectFrom(patterns: ReadonlyArray<readonly [RegExp, string]>, userAgent: string): string | null {
  const found = patterns.find(([pattern]) => pattern.test(userAgent));
  return found === undefined ? null : found[1];
}

/**
 * User-Agentから端末の名前を作る（「iPhone · Safari」の形。PU-13）。
 * 端末かブラウザのどちらかだけ分かるときは、その名前だけ使う。
 * どちらも分からなければ「この端末」。契約の上限60文字を超えない。
 */
export function deviceLabelFromUserAgent(userAgent: string): string {
  const device = detectFrom(DEVICES, userAgent);
  const browser = detectFrom(BROWSERS, userAgent);
  const parts = [device, browser].filter((part): part is string => part !== null);
  const label = parts.length === 0 ? FALLBACK_DEVICE_LABEL : parts.join(" · ");
  const chars = Array.from(label);
  return chars.length <= DEVICE_LABEL_MAX_LENGTH
    ? label
    : chars.slice(0, DEVICE_LABEL_MAX_LENGTH).join("");
}
