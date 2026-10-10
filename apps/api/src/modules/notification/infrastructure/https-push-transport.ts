import { request as httpsRequest, type Agent } from "node:https";
import type {
  PushRequestDetails,
  PushTransport,
} from "../adapter/outbound/push-transport";

/** 1送りの全体の上限（設計書「エラー処理」: 購読あたり3秒）。 */
const SEND_TIMEOUT_MS = 3_000;

/**
 * Nodeのhttps.requestで送る本物の送る口（設計書「送る部品」）。
 * AbortSignalによる3秒の全体の打ち切り（名前の解決・接続・応答の待ちまで
 * 含む）と、転送を追わない設定（3xxはそのままの状態で返る）。
 * agentは試験が自己署名の証明書（caつき）を渡すためだけの口。
 * 本番ではnullのままにし、https.requestには項目ごと渡さない
 * （既定の証明書の検証をそのまま使う）。
 */
export class HttpsPushTransport implements PushTransport {
  constructor(private readonly agent: Agent | null = null) {}

  send(request: PushRequestDetails): Promise<Readonly<{ status: number }>> {
    return new Promise((resolve, reject) => {
      const req = httpsRequest(
        request.endpoint,
        {
          method: request.method,
          headers: request.headers,
          signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
          ...(this.agent === null ? {} : { agent: this.agent }),
        },
        (response) => {
          // 本体は使わない（受け取らないとソケットが詰まるため流す）。
          response.resume();
          response.on("end", () => {
            resolve({ status: response.statusCode ?? 0 });
          });
        },
      );
      req.on("error", reject);
      req.end(request.body);
    });
  }
}
