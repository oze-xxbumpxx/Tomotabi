import { describe, expect, it } from "vitest";
import { checkPushEndpoint } from "../../../src/modules/notification/domain/push-endpoint";

/**
 * PU-01: 宛先の決まり（https・ポート443・userinfo無し・fragment無し・
 * IPアドレスとlocalhostを断る・許可する配信サービスのホストだけ）。
 * 成功の結果は正規化した宛先（url.href）を持ち、
 * 保存・ハッシュ・比較はその値だけを使う。
 */
describe("checkPushEndpoint", () => {
  it.each([
    [
      "https://fcm.googleapis.com/fcm/send/abc123",
      "https://fcm.googleapis.com/fcm/send/abc123",
    ],
    // :443（先頭に0が付いても）は既定ポートで、解析で取り除かれる。
    [
      "https://fcm.googleapis.com:443/fcm/send/abc123",
      "https://fcm.googleapis.com/fcm/send/abc123",
    ],
    [
      "https://fcm.googleapis.com:0443/fcm/send/x",
      "https://fcm.googleapis.com/fcm/send/x",
    ],
    [
      "https://ab12cd.push.apple.com/QPusher/abcdef",
      "https://ab12cd.push.apple.com/QPusher/abcdef",
    ],
    [
      "https://a.b.push.apple.com/x",
      "https://a.b.push.apple.com/x",
    ],
    [
      "https://fcm.googleapis.com/fcm/send/abc?x=1",
      "https://fcm.googleapis.com/fcm/send/abc?x=1",
    ],
    // ホストの大文字は解析で小文字に正規化される。
    [
      "https://FCM.GOOGLEAPIS.COM/fcm/send/abc",
      "https://fcm.googleapis.com/fcm/send/abc",
    ],
    [
      "https://AB12CD.PUSH.APPLE.COM/x",
      "https://ab12cd.push.apple.com/x",
    ],
  ])("accepts %s as %s", (endpoint, normalized) => {
    expect(checkPushEndpoint(endpoint)).toEqual({
      ok: true,
      endpoint: normalized,
    });
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
    // 末尾のドットは完全一致から外れる。
    ["https://fcm.googleapis.com./x", "host_not_allowed"],
    ["https://evilpush.apple.com/x", "host_not_allowed"],
    ["https://push.apple.com/x", "host_not_allowed"],
    // 先頭のラベルが空の形は許さない。
    ["https://.push.apple.com/x", "host_not_allowed"],
    // WHATWGは単一の数・16進のホストをIPv4として読む。
    ["https://2130706433/x", "host_not_allowed"],
    ["https://0x7f.1/x", "host_not_allowed"],
    ["not a url", "invalid_url"],
    ["", "invalid_url"],
    // タブ・CR・LFは解析の前に取り除かれるため、生の文字列で断る。
    ["https://fcm.googleapis.com/fcm/send/\tx", "invalid_url"],
    ["https://fcm.googleapis.com/fcm/send/\nx", "invalid_url"],
    ["https://fcm.googleapis.com/fcm/send/\r\nx", "invalid_url"],
    ["https://fcm.googleapis.com/\tx", "invalid_url"],
    // NULなど残る制御文字も同じく断る。
    ["https://fcm.googleapis.com/\u0000x", "invalid_url"],
    ["https://fcm.googleapis.com/x\u000b", "invalid_url"],
  ])("rejects %s with %s", (endpoint, reason) => {
    expect(checkPushEndpoint(endpoint)).toEqual({ ok: false, reason });
  });
});
