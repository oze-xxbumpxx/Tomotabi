/** VAPIDの鍵の状態。一覧のvapidKeyStateと同じ語。 */
export type VapidKeyState = "current" | "retired" | "revoked";

/** VAPIDの鍵1つ。revokedは公開鍵・秘密鍵を持たない。 */
export type VapidKey = {
  /** 鍵のID。DBのvapid_key_idに入るので1〜64文字。 */
  keyId: string;
  state: VapidKeyState;
  /** base64urlの65バイト非圧縮点。revokedはnull。 */
  publicKey: string | null;
  /** base64urlの32バイト。current・retiredだけが持つ。revokedはnull。 */
  privateKey: string | null;
};

/** 鍵の束の読み込み結果。 */
export type VapidKeyring =
  | {
      status: "ready";
      /** VAPID_SUBJECT。配信サービスに示す運用者の連絡先。 */
      subject: string;
      /** stateがcurrentの唯一の鍵。push-config応答と購読登録の照合に使う。 */
      current: VapidKey;
      /** keyId→鍵。送るときは購読が記録したvapid_key_idの鍵で署名する。 */
      keys: ReadonlyMap<string, VapidKey>;
    }
  | {
      status: "unavailable";
      /** 崩れ方の説明。鍵の値を含まない固定の語だけで書く。 */
      reason: string;
    };
