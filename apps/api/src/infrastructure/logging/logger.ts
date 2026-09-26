import { HttpException } from "@nestjs/common";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { DestinationStream, LogFn, Logger } from "pino";
import { pinoHttp, type HttpLogger, type Options } from "pino-http";

const INTERNAL_ERROR_CODE = "INTERNAL_ERROR";

// 設計書で許可された Guard の結果コードと、認証経路の経路制限が返す NOT_FOUND。
// それ以外の値は code に出さない。
const KNOWN_LOG_CODES: ReadonlySet<string> = new Set([
  "UNAUTHENTICATED",
  "FORBIDDEN_NOT_ALLOWED",
  "FORBIDDEN_ORIGIN",
  "UNSUPPORTED_MEDIA_TYPE",
  "AUTH_UNAVAILABLE",
  "NOT_FOUND",
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

// Guard・経路制限が結果コードを渡すための取り決め（res.locals.code に書く）。
// pino-http はエラー時に res.err を参照する。
type ResponseWithInternals = ServerResponse & {
  err?: unknown;
  locals?: { code?: unknown };
};

// express は mount 先（app.use("/api/auth", ...)）の中で req.url を相対パスに書き換える。
// その中で応答が終わると req.url が相対のままなので、元の URL を持つ originalUrl を優先する。
type RequestWithOriginalUrl = IncomingMessage & { originalUrl?: unknown };

function requestUrl(req: IncomingMessage): string | undefined {
  const { originalUrl } = req as RequestWithOriginalUrl;
  return typeof originalUrl === "string" ? originalUrl : req.url;
}

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
    path: pathWithoutQuery(requestUrl(req)),
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

// Nest の ExceptionsHandler は例外を Nest logger（= この pino）の err に入れて
// 直接出すため、pino-http の出力制御だけでは message / stack が漏れる。
// pino-http は err serializer を std serializer の結果
// （{ type, message, stack, raw }）を入力に呼ぶので、raw があれば元の Error で code を判定する。
// 鍵名を errorCode にしているのは、redact の "*.code" が err.code を [Redacted] にするため。
function serializeLoggedError(value: unknown): { type: string; errorCode: string } {
  const raw =
    typeof value === "object" && value !== null && "raw" in value ? value.raw : value;
  const type = raw instanceof Error ? raw.constructor.name : "Unknown";
  return { type, errorCode: codeFromError(raw) };
}

// pino は msg を渡さず err / Error をログに出すと msg に err.message を自動転記する。
// 静的な msg を補って転記を止める（ExceptionsHandler 経路がまさにこの形）。
function isErrorLike(value: unknown): boolean {
  return (
    value instanceof Error ||
    (typeof value === "object" &&
      value !== null &&
      typeof (value as { message?: unknown }).message === "string")
  );
}

function suppressErrorMessageAutofill(
  this: Logger,
  args: Parameters<LogFn>,
  method: LogFn,
): void {
  const [first, second] = args;
  const hasErrorArg =
    first instanceof Error ||
    (typeof first === "object" &&
      first !== null &&
      "err" in first &&
      isErrorLike(first.err));
  if (hasErrorArg && second === undefined) {
    method.apply(this, [first, "unhandled exception"]);
    return;
  }
  method.apply(this, args);
}

/**
 * 1 要求 1 行の pino-http 設定。
 * 出力は requestId / method / path（クエリを除く）/ statusCode / responseTime /
 * code（Guard の結果コード。無いときは出さない）に限る。
 * err はオブジェクトごと取り除き、既知の code だけを出す。
 *
 * serializers.err と hooks.logMethod はこの logger を共有する Nest logger
 * （ExceptionsHandler など）経由の例外にも効かせるためのもので、
 * err を { type, errorCode } に変換し、msg への message 自動転記を止める。
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
    serializers: { err: serializeLoggedError },
    hooks: { logMethod: suppressErrorMessageAutofill },
    redact: { paths: [...REDACT_PATHS], censor: "[Redacted]" },
  };
}

/**
 * 1 要求 1 行を書く pino-http ミドルウェア。configureApp が express の先頭に載せ、
 * 認証経路（/api/auth/*。Nest に入る前に allowlist / Better Auth が応答する）も
 * 同じ 1 行ログに乗せる。Nest 側は nestjs-pino の useExisting で req.log を共有する。
 * stream はテストが出力を捕まえるために渡す。
 */
export function createRequestLogger(stream?: DestinationStream): HttpLogger {
  return stream === undefined
    ? pinoHttp(createPinoHttpOptions())
    : pinoHttp(createPinoHttpOptions(), stream);
}
