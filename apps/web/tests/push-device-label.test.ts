import { describe, expect, it } from "vitest";
import {
  deviceLabelFromUserAgent,
  FALLBACK_DEVICE_LABEL,
} from "@/shared/push/device-label";

const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const IPHONE_CHROME =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.0.0 Mobile/15E148 Safari/604.1";
const IPAD_SAFARI =
  "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
const ANDROID_FIREFOX =
  "Mozilla/5.0 (Android 14; Mobile; rv:121.0) Gecko/121.0 Firefox/121.0";
const MAC_SAFARI =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const MAC_CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const MAC_EDGE =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0";
const WINDOWS_CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const WINDOWS_EDGE =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0";
const WINDOWS_FIREFOX =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0";

describe("deviceLabelFromUserAgent（端末の名前）", () => {
  it.each([
    [IPHONE_SAFARI, "iPhone · Safari"],
    [IPHONE_CHROME, "iPhone · Chrome"],
    [IPAD_SAFARI, "iPad · Safari"],
    [ANDROID_CHROME, "Android · Chrome"],
    [ANDROID_FIREFOX, "Android · Firefox"],
    [MAC_SAFARI, "Mac · Safari"],
    [MAC_CHROME, "Mac · Chrome"],
    [MAC_EDGE, "Mac · Edge"],
    [WINDOWS_CHROME, "Windows · Chrome"],
    [WINDOWS_EDGE, "Windows · Edge"],
    [WINDOWS_FIREFOX, "Windows · Firefox"],
  ])("「%s」→ %s", (userAgent, expected) => {
    expect(deviceLabelFromUserAgent(userAgent)).toBe(expected);
  });

  it("わからなければ「この端末」", () => {
    expect(deviceLabelFromUserAgent("")).toBe(FALLBACK_DEVICE_LABEL);
    expect(deviceLabelFromUserAgent("curl/8.5.0")).toBe(FALLBACK_DEVICE_LABEL);
    expect(deviceLabelFromUserAgent("")).toBe("この端末");
  });

  it("60文字以内", () => {
    const long =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) " +
      "X".repeat(200) +
      " Version/17.0 Safari/604.1";
    const label = deviceLabelFromUserAgent(long);
    expect(Array.from(label).length).toBeLessThanOrEqual(60);
  });
});
