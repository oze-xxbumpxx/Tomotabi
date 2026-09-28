import {
  Catch,
  HttpException,
  HttpStatus,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import type { ApiErrorBody } from "@tomotabi/contracts";
import { ApiError, type ApiErrorCode } from "./api-error";

/**
 * 想定外の例外に返す固定文。例外の message（DB の URL・接続情報を含み得る）を
 * そのまま応答へ出さない。
 */
const INTERNAL_ERROR_BODY = {
  code: "INTERNAL_ERROR",
  status: HttpStatus.INTERNAL_SERVER_ERROR,
  message: "Internal server error",
  retryable: false,
} as const;

const TEMPORARILY_UNAVAILABLE_BODY = {
  code: "TEMPORARILY_UNAVAILABLE",
  status: HttpStatus.SERVICE_UNAVAILABLE,
  message: "Service is temporarily unavailable",
  retryable: true,
} as const;

/**
 * `code`・`message` を持たない HttpException の、HTTP 状態からの既定の写像。
 */
const STATUS_FALLBACK: Readonly<
  Record<number, { code: ApiErrorCode; message: string }>
> = {
  400: { code: "INVALID_REQUEST", message: "Invalid request" },
  401: { code: "UNAUTHENTICATED", message: "Authentication required" },
  403: { code: "FORBIDDEN_NOT_ALLOWED", message: "Forbidden" },
  404: { code: "NOT_FOUND", message: "Not found" },
  415: { code: "UNSUPPORTED_MEDIA_TYPE", message: "Content-Type must be application/json" },
  422: { code: "VALIDATION_FAILED", message: "Validation failed" },
  428: { code: "IF_MATCH_REQUIRED", message: "If-Match header is required" },
};

/**
 * DB 接続の失敗・一時的な競合として 503 retryable=true に写すエラーの code。
 * node（接続系）と pg の SQLSTATE（クラス 08: 接続例外、40001: 直列化失敗、
 * 40P01: デッドロック）を対象にする。
 */
const TRANSIENT_ERROR_CODES: ReadonlySet<string> = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EPIPE",
  "ENOTFOUND",
  "ENETUNREACH",
  "EAI_AGAIN",
  "40001",
  "40P01",
]);

/** cause チェーンを辿る深さの上限（循環する cause でも打ち切る）。 */
const MAX_CAUSE_DEPTH = 8;

function isTransientDbError(value: unknown): boolean {
  // drizzle は pg のエラーを DrizzleQueryError の cause に包んで投げるため、
  // cause チェーンを辿って SQLSTATE / errno を見る。循環する cause が届いても
  // 終わるよう、深さに上限を設ける。
  let current: unknown = value;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
    if (typeof current !== "object" || current === null) {
      return false;
    }
    const code = (current as { code?: unknown }).code;
    if (
      typeof code === "string" &&
      (TRANSIENT_ERROR_CODES.has(code) || code.startsWith("08"))
    ) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

type NormalizedError = {
  code: ApiErrorCode | string;
  status: number;
  message: string;
  retryable: boolean;
};

function normalize(exception: unknown): NormalizedError {
  if (exception instanceof ApiError) {
    return {
      code: exception.code,
      status: exception.status,
      message: exception.message,
      retryable: exception.retryable,
    };
  }
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const body: unknown = exception.getResponse();
    if (
      typeof body === "object" &&
      body !== null &&
      "code" in body &&
      typeof (body as { code: unknown }).code === "string"
    ) {
      const message =
        "message" in body && typeof (body as { message: unknown }).message === "string"
          ? (body as { message: string }).message
          : (STATUS_FALLBACK[status]?.message ?? "Invalid request");
      return {
        code: (body as { code: string }).code,
        status,
        message,
        retryable: status === HttpStatus.SERVICE_UNAVAILABLE,
      };
    }
    const fallback = STATUS_FALLBACK[status];
    if (fallback !== undefined) {
      return { ...fallback, status, retryable: status === HttpStatus.SERVICE_UNAVAILABLE };
    }
    if (status === HttpStatus.SERVICE_UNAVAILABLE) {
      return { ...TEMPORARILY_UNAVAILABLE_BODY };
    }
    return status < HttpStatus.INTERNAL_SERVER_ERROR
      ? { ...STATUS_FALLBACK[400]!, status, retryable: false }
      : { ...INTERNAL_ERROR_BODY };
  }
  if (isTransientDbError(exception)) {
    return { ...TEMPORARILY_UNAVAILABLE_BODY };
  }
  return { ...INTERNAL_ERROR_BODY };
}

function requestIdOf(request: Request): string {
  const id = (request as { id?: unknown }).id;
  return typeof id === "string" && id.length > 0 ? id : randomUUID();
}

/**
 * すべての例外を `{ code, message, requestId, retryable }` の形に揃える（APP_FILTER）。
 * requestId は pino-http が req.id に振る要求 id（UUID）。pino-http が無い経路では
 * その場で UUID を振る。想定外の例外は 500 の固定文で、スタックや外部ライブラリの
 * message は出さない（ログ側でも同様に握りつぶす）。
 */
@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();
    const normalized = normalize(exception);

    // M1-b2 の取り決め: 結果コードを res.locals.code に書く（ログは既知の code だけを出す）
    (response.locals ??= {}).code = normalized.code;

    const body: ApiErrorBody = {
      code: normalized.code,
      message: normalized.message,
      requestId: requestIdOf(request),
      retryable: normalized.retryable,
    };
    response.status(normalized.status).json(body);
  }
}
