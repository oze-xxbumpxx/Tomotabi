import { HttpException } from "@nestjs/common";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Options } from "pino-http";

const INTERNAL_ERROR_CODE = "INTERNAL_ERROR";

// 設計書で許可された Guard の結果コード。それ以外の値は code に出さない。
const KNOWN_LOG_CODES: ReadonlySet<string> = new Set([
  "UNAUTHENTICATED",
  "FORBIDDEN_NOT_ALLOWED",
  "FORBIDDEN_ORIGIN",
  "UNSUPPORTED_MEDIA_TYPE",
  "AUTH_UNAVAILABLE",
]);

// redact は防御の二重化。主の対策は、出力項目を絞る customProps / customObject 側にある。
const REDACT_PATHS = [
  "req.headers.cookie",
  "req.headers.authorization",
  'res.headers["set-cookie"]',
  "*.token",
  "*.accessToken",
  "*.idToken",
  "*.refreshToken",
  "*.code",
  "*.sub",
];

// Guard が結果コードを渡すための取り決め（M1-b4 の Guard / 例外フィルタが res.locals.code に書く）。
// pino-http はエラー時に res.err を参照する。
type ResponseWithInternals = ServerResponse & {
  err?: unknown;
  locals?: { code?: unknown };
};

function pathWithoutQuery(url: string | undefined): string {
  if (url === undefined) {
    return "";
  }
  const queryIndex = url.indexOf("?");
  return queryIndex === -1 ? url : url.slice(0, queryIndex);
}

function knownCode(value: unknown): string | null {
  return typeof value === "string" && KNOWN_LOG_CODES.has(value) ? value : null;
}

function codeFromError(err: unknown): string {
  if (err instanceof HttpException) {
    const body: unknown = err.getResponse();
    if (typeof body === "object" && body !== null && "code" in body) {
      const known = knownCode(body.code);
      if (known !== null) {
        return known;
      }
    }
    return INTERNAL_ERROR_CODE;
  }
  if (typeof err === "object" && err !== null && "code" in err) {
    const known = knownCode(err.code);
    if (known !== null) {
      return known;
    }
  }
  return INTERNAL_ERROR_CODE;
}

function resolveCode(res: ServerResponse): string | null {
  const state = res as ResponseWithInternals;
  const localCode = knownCode(state.locals?.code);
  if (localCode !== null) {
    return localCode;
  }
  if (state.err !== undefined) {
    return codeFromError(state.err);
  }
  if (res.statusCode >= 500) {
    return INTERNAL_ERROR_CODE;
  }
  return null;
}

function requestLogFields(req: IncomingMessage, res: ServerResponse): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    method: req.method,
    path: pathWithoutQuery(req.url),
    statusCode: res.statusCode,
  };
  const code = resolveCode(res);
  if (code !== null) {
    fields.code = code;
  }
  return fields;
}

// pino-http の message provider が undefined を返すと msg 自体を出さない。
// 例外時も customErrorObject で err を除くため、err.message が msg に回り込まない。
// 型は string 固定なので、実行時の契約に合わせて undefined を返す。
function omitMessage(): string {
  return undefined as unknown as string;
}

function hasError(res: ServerResponse, err: Error | undefined): boolean {
  const state = res as ResponseWithInternals;
  return err !== undefined || state.err !== undefined || res.statusCode >= 500;
}

/**
 * 1 要求 1 行の pino-http 設定。
 * 出力は requestId / method / path（クエリを除く）/ statusCode / responseTime /
 * code（Guard の結果コード。無いときは出さない）に限る。
 * err はオブジェクトごと取り除き、既知の code だけを出す。
 */
export function createPinoHttpOptions(): Options {
  return {
    level: "info",
    base: null,
    quietReqLogger: true,
    quietResLogger: true,
    customAttributeKeys: { reqId: "requestId" },
    customProps: requestLogFields,
    customSuccessObject: (
      _req: IncomingMessage,
      _res: ServerResponse,
      value: { responseTime: number },
    ): { responseTime: number } => ({ responseTime: value.responseTime }),
    customErrorObject: (
      _req: IncomingMessage,
      _res: ServerResponse,
      _err: Error,
      value: { responseTime: number },
    ): { responseTime: number } => ({ responseTime: value.responseTime }),
    customSuccessMessage: omitMessage,
    customErrorMessage: omitMessage,
    customLogLevel: (
      _req: IncomingMessage,
      res: ServerResponse,
      err?: Error,
    ): "error" | "info" => (hasError(res, err) ? "error" : "info"),
    redact: { paths: [...REDACT_PATHS], censor: "[Redacted]" },
  };
}
