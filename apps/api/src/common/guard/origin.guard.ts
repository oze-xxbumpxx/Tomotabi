import {
  ForbiddenException,
  Inject,
  Injectable,
  UnsupportedMediaTypeException,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import type { Request } from "express";

export const ALLOWED_ORIGINS = Symbol("ALLOWED_ORIGINS");

const SAFE_METHODS = new Set(["GET", "HEAD"]);
const JSON_MEDIA_TYPE = "application/json";

/**
 * GET / HEAD はそのまま通す。それ以外の要求は Origin の完全一致を先に確かめ、
 * 一致したら Content-Type: application/json を確かめる。
 */
@Injectable()
export class OriginGuard implements CanActivate {
  constructor(
    @Inject(ALLOWED_ORIGINS)
    private readonly allowedOrigins: readonly string[],
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(request.method)) {
      return true;
    }

    const origin = request.headers.origin;
    if (typeof origin !== "string" || !this.allowedOrigins.includes(origin)) {
      throw new ForbiddenException({
        code: "FORBIDDEN_ORIGIN",
        message: "Origin is not allowed",
      });
    }

    const contentType = request.headers["content-type"];
    const mediaType =
      typeof contentType === "string"
        ? contentType.split(";")[0]?.trim().toLowerCase()
        : null;
    if (mediaType !== JSON_MEDIA_TYPE) {
      throw new UnsupportedMediaTypeException({
        code: "UNSUPPORTED_MEDIA_TYPE",
        message: "Content-Type must be application/json",
      });
    }

    return true;
  }
}
