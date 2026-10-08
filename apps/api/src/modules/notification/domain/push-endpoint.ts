/**
 * Pushの宛先（endpoint）の決まり。購読の登録と送信の両方が使う純粋関数
 * （詳細設計「宛先の検証」）。断る理由は固定の語だけで、
 * 値そのものは返さない（宛先は秘密として扱い、ログにも出さない）。
 */

export type PushEndpointRejection =
  | "invalid_url"
  | "not_https"
  | "port_not_443"
  | "has_userinfo"
  | "has_fragment"
  | "host_not_allowed";

export type PushEndpointCheck =
  | { ok: true }
  | { ok: false; reason: PushEndpointRejection };

const IPV4_HOST = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/**
 * 許可する配信サービスのホスト。`*.push.apple.com`はラベルの境界でだけ
 * 一致する（evilpush.apple.comは断る）。fcm.googleapis.com.evil.example
 * のような後ろに別名が付く形も完全一致でないため断られる。
 */
const isAllowedHost = (hostname: string): boolean =>
  hostname === "fcm.googleapis.com" || hostname.endsWith(".push.apple.com");

export function checkPushEndpoint(endpoint: string): PushEndpointCheck {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }
  if (url.protocol !== "https:") {
    return { ok: false, reason: "not_https" };
  }
  // httpsの既定ポート443はURLの解析で空に正規化される。明示の:443も
  // 同じく空になるため、残るportの値はすべて拒否でよい。
  if (url.port !== "") {
    return { ok: false, reason: "port_not_443" };
  }
  if (url.username !== "" || url.password !== "") {
    return { ok: false, reason: "has_userinfo" };
  }
  if (url.hash !== "") {
    return { ok: false, reason: "has_fragment" };
  }
  const hostname = url.hostname;
  // IPアドレス（IPv4の数字列・IPv6の[]囲み）とlocalhostは許可リストの
  // 確認より前に明示して断る（許可リストの改変で素通しにならないように）。
  const isIpLiteral = IPV4_HOST.test(hostname) || hostname.startsWith("[");
  if (
    isIpLiteral ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    !isAllowedHost(hostname)
  ) {
    return { ok: false, reason: "host_not_allowed" };
  }
  return { ok: true };
}
