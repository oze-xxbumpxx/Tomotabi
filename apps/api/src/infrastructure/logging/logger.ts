import { HttpException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { DestinationStream, LogFn, Logger } from "pino";
import { pinoHttp, type HttpLogger, type Options } from "pino-http";

const INTERNAL_ERROR_CODE = "INTERNAL_ERROR";

// 設計書で許可されたGuardの結果コードと、認証経路の経路制限が返すNOT_FOUND。
// それ以外の値はcodeに出さない。
const KNOWN_LOG_CODES: ReadonlySet<string> = new Set([
  "UNAUTHENTICATED",
  "FORBIDDEN_NOT_ALLOWED",
  "FORBIDDEN_ORIGIN",
  "UNSUPPORTED_MEDIA_TYPE",
  "AUTH_UNAVAILABLE",
  "PUSH_STOP_FAILED",
  "NOT_FOUND",
]);

// redactは防御の二重化。主の対策は、出力項目を絞るcustomProps / customObject側にある。
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
  "*.endpoint",
  "*.keys",
  "*.p256dh",
  "*.auth",
  // 実際のログの深さに届くパス（要求bodyの宛先と鍵）。
  // "*.endpoint"等は最上段だけに効くため、bodyの下は別に指定する。
  "req.body.endpoint",
  "req.body.keys",
  "req.body.keys.p256dh",
  "req.body.keys.auth",
];

// Guard・経路制限が結果コードを渡すための取り決め（res.locals.codeに書く）。
// pino-httpはエラー時にres.errを参照する。
type ResponseWithInternals = ServerResponse & {
  err?: unknown;
  locals?: { code?: unknown };
};

// expressはmount先（app.use("/api/auth", ...)）の中でreq.urlを相対パスに書き換える。
// その中で応答が終わるとreq.urlが相対のままなので、元のURLを持つoriginalUrlを優先する。
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

// pino-httpのmessage providerがundefinedを返すとmsg自体を出さない。
// 例外時もcustomErrorObjectでerrを除くため、err.messageがmsgに回り込まない。
// 型はstring固定なので、実行時の契約に合わせてundefinedを返す。
function omitMessage(): string {
  return undefined as unknown as string;
}

function hasError(res: ServerResponse, err: Error | undefined): boolean {
  const state = res as ResponseWithInternals;
  return err !== undefined || state.err !== undefined || res.statusCode >= 500;
}

// NestのExceptionsHandlerは例外をNest logger（= このpino）のerrに入れて
// 直接出すため、pino-httpの出力制御だけではmessage / stackが漏れる。
// pino-httpはerr serializerをstd serializerの結果
// （{ type, message, stack, raw }）を入力に呼ぶので、rawがあれば元のErrorでcodeを判定する。
// 鍵名をerrorCodeにしているのは、redactの"*.code"がerr.codeを[Redacted]にするため。
function serializeLoggedError(value: unknown): { type: string; errorCode: string } {
  const raw =
    typeof value === "object" && value !== null && "raw" in value ? value.raw : value;
  const type = raw instanceof Error ? raw.constructor.name : "Unknown";
  return { type, errorCode: codeFromError(raw) };
}

// pinoはmsgを渡さずerr / Errorをログに出すとmsgにerr.messageを自動転記する。
// 静的なmsgを補って転記を止める（ExceptionsHandler経路がまさにこの形）。
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
 * 1要求1行のpino-http設定。
 * 出力はrequestId / method / path（クエリを除く）/ statusCode / responseTime /
 * code（Guardの結果コード。無いときは出さない）に限る。
 * errはオブジェクトごと取り除き、既知のcodeだけを出す。
 *
 * serializers.errとhooks.logMethodはこのloggerを共有するNest logger
 * （ExceptionsHandlerなど）経由の例外にも効かせるためのもので、
 * errを { type, errorCode } に変換し、msgへのmessage自動転記を止める。
 */
export function createPinoHttpOptions(): Options {
  return {
    level: "info",
    base: null,
    quietReqLogger: true,
    quietResLogger: true,
    // エラー応答のrequestIdと同じ値。契約はUUID形式なのでUUIDを振る
    // （既定の整数連番ではなく、クライアントのヘッダーも使わない）。
    genReqId: () => randomUUID(),
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
 * 1要求1行を書くpino-httpミドルウェア。configureAppがexpressの先頭に載せ、
 * 認証経路（/api/auth/*。Nestに入る前にallowlist / Better Authが応答する）も
 * 同じ1行ログに乗せる。Nest側はnestjs-pinoのuseExistingでreq.logを共有する。
 * streamはテストが出力を捕まえるために渡す。
 */
export function createRequestLogger(stream?: DestinationStream): HttpLogger {
  return stream === undefined
    ? pinoHttp(createPinoHttpOptions())
    : pinoHttp(createPinoHttpOptions(), stream);
}
