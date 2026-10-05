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
import { someInCauseChain } from "../errors/find-in-cause-chain";
import {
  ApiError,
  type ApiErrorCode,
  type ApiErrorDetails,
} from "./api-error";

/**
 * 想定外の例外に返す固定文。例外のmessage（DBのURL・接続情報を含み得る）を
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
 * `code`・`message`を持たないHttpExceptionの、HTTP状態からの既定の写像。
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
 * DB接続の失敗・一時的な競合として503 retryable=trueに写すエラーのcode。
 * node（接続系）とpgのSQLSTATE（クラス08: 接続例外、40001: 直列化失敗、
 * 40P01: デッドロック、55P03: lock_not_available＝lock_timeoutの打ち切り）を
 * 対象にする。
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
  "55P03",
]);

function isTransientDbError(value: unknown): boolean {
  // drizzleはpgのエラーをDrizzleQueryErrorのcauseに包んで投げるため、
  // causeチェーンを辿ってSQLSTATE / errnoを見る。
  return someInCauseChain(value, (node) => {
    const code = (node as { code?: unknown }).code;
    return (
      typeof code === "string" &&
      (TRANSIENT_ERROR_CODES.has(code) || code.startsWith("08"))
    );
  });
}

type NormalizedError = {
  code: ApiErrorCode | string;
  status: number;
  message: string;
  retryable: boolean;
  details?: ApiErrorDetails;
};

function normalize(exception: unknown): NormalizedError {
  if (exception instanceof ApiError) {
    return {
      code: exception.code,
      status: exception.status,
      message: exception.message,
      retryable: exception.retryable,
      details: exception.details,
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
 * すべての例外を`{ code, message, requestId, retryable }`の形に揃える（APP_FILTER）。
 * requestIdはpino-httpがreq.idに振る要求id（UUID）。pino-httpが無い経路では
 * その場でUUIDを振る。想定外の例外は500の固定文で、スタックや外部ライブラリの
 * messageは出さない（ログ側でも同様に握りつぶす）。
 */
@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();
    const normalized = normalize(exception);

    // M1-b2の取り決め: 結果コードをres.locals.codeに書く（ログは既知のcodeだけを出す）
    (response.locals ??= {}).code = normalized.code;

    const body: ApiErrorBody = {
      code: normalized.code,
      message: normalized.message,
      requestId: requestIdOf(request),
      retryable: normalized.retryable,
    };
    if (normalized.details?.existingSettlementId !== undefined) {
      body.existingSettlementId = normalized.details.existingSettlementId;
    }
    if (normalized.details?.changedPaymentIds !== undefined) {
      body.changedPaymentIds = [...normalized.details.changedPaymentIds];
    }
    if (normalized.details?.existingRecordId !== undefined) {
      body.existingRecordId = normalized.details.existingRecordId;
    }
    response.status(normalized.status).json(body);
  }
}
