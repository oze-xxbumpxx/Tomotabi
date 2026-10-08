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

/**
 * 成功の結果は正規化した宛先（url.href）を持つ。
 * WHATWGの解析はタブ・CR・LFを取り除くため、生の文字列と
 * 解析後の値は違い得る。保存・ハッシュ・比較はこの値だけを使う。
 */
export type PushEndpointCheck =
  | { ok: true; endpoint: string }
  | { ok: false; reason: PushEndpointRejection };

const IPV4_HOST = /^\d{1,3}(?:\.\d{1,3}){3}$/;

// 生の文字列に残る制御文字（NUL・タブ・改行など）。WHATWGは解析の前に
// タブ・CR・LFを取り除くため、生の値を確かめないと取り除いた形が
// 通ってしまう。残る制御文字を含む宛先は受け取らない。
const CONTROL_CHAR = /\p{Cc}/u;

/**
 * 許可する配信サービスのホスト。
 * FCMは完全一致（末尾のドットや後ろに別名が付く形は断る）。
 * Appleは1文字以上のラベルが1つ以上付く`*.push.apple.com`だけ
 * （先頭のラベルが空の`.push.apple.com`や`push.apple.com`そのもの、
 * `evilpush.apple.com`は断る）。
 */
const APPLE_PUSH_HOST = /^(?:[a-z0-9-]+\.)+push\.apple\.com$/;

const isAllowedHost = (hostname: string): boolean =>
  hostname === "fcm.googleapis.com" || APPLE_PUSH_HOST.test(hostname);

/**
 * 生の宛先の文字列に制御文字が残るか。
 * zod.url()は解析でタブ・CR・LFを取り除いて正規化した値を返すため、
 * UseCaseの入力には生の形が届かない。生の本文を見る側（controller）が
 * 使う。checkPushEndpointも同じ確認を最初に行う。
 */
export const endpointHasControlChar = (endpoint: string): boolean =>
  CONTROL_CHAR.test(endpoint);

export function checkPushEndpoint(endpoint: string): PushEndpointCheck {
  if (CONTROL_CHAR.test(endpoint)) {
    return { ok: false, reason: "invalid_url" };
  }
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
  // WHATWGは単一の数（2130706433）や16進（0x7f.1）のホストも
  // IPv4として読むため、ここに来る時点で正規化済みの形になる。
  const isIpLiteral = IPV4_HOST.test(hostname) || hostname.startsWith("[");
  if (
    isIpLiteral ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    !isAllowedHost(hostname)
  ) {
    return { ok: false, reason: "host_not_allowed" };
  }
  return { ok: true, endpoint: url.href };
}
