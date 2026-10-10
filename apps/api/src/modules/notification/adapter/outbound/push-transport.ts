export const PUSH_TRANSPORT = Symbol("PUSH_TRANSPORT");

/**
 * HTTPSで配信サービスへ送る要求。web-pushのgenerateRequestDetailsが
 * 作る暗号化・署名済みの形（method・headers・bodyをそのまま流す）。
 */
export type PushRequestDetails = Readonly<{
  endpoint: string;
  method: string;
  headers: Readonly<Record<string, string>>;
  body: Buffer;
}>;

/**
 * HTTPSで送る口（設計書「送る部品」）。
 * 応答が返ればそのHTTPの状態を返し、通信の失敗・時間切れは例外で伝える。
 * 試験ではこの口だけを偽物に差し替える（宛先の決まりは通さない）。
 */
export interface PushTransport {
  send(request: PushRequestDetails): Promise<Readonly<{ status: number }>>;
}
