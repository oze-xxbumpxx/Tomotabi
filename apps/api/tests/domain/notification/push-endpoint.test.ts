import { describe, expect, it } from "vitest";
import { checkPushEndpoint } from "../../../src/modules/notification/domain/push-endpoint";

/**
 * PU-01: 宛先の決まり（https・ポート443・userinfo無し・fragment無し・
 * IPアドレスとlocalhostを断る・許可する配信サービスのホストだけ）。
 */
describe("checkPushEndpoint", () => {
  it.each([
    "https://fcm.googleapis.com/fcm/send/abc123",
    "https://fcm.googleapis.com:443/fcm/send/abc123",
    "https://ab12cd.push.apple.com/QPusher/abcdef",
    "https://fcm.googleapis.com/fcm/send/abc?x=1",
  ])("accepts %s", (endpoint) => {
    expect(checkPushEndpoint(endpoint)).toEqual({ ok: true });
  });

  it.each([
    ["https://fcm.googleapis.com:444/fcm/send/x", "port_not_443"],
    ["https://user@fcm.googleapis.com/x", "has_userinfo"],
    ["https://user:pw@fcm.googleapis.com/x", "has_userinfo"],
    ["https://fcm.googleapis.com/x#frag", "has_fragment"],
    ["http://fcm.googleapis.com/x", "not_https"],
    ["https://1.2.3.4/x", "host_not_allowed"],
    ["https://[::1]/x", "host_not_allowed"],
    ["https://localhost/x", "host_not_allowed"],
    ["https://app.localhost/x", "host_not_allowed"],
    ["https://push.example.com/x", "host_not_allowed"],
    ["https://fcm.googleapis.com.evil.example/x", "host_not_allowed"],
    ["https://evilpush.apple.com/x", "host_not_allowed"],
    ["https://push.apple.com/x", "host_not_allowed"],
    ["not a url", "invalid_url"],
    ["", "invalid_url"],
  ])("rejects %s with %s", (endpoint, reason) => {
    expect(checkPushEndpoint(endpoint)).toEqual({ ok: false, reason });
  });
});
