import {
  ForbiddenException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import {
  SESSION_VERIFIER,
  type SessionVerifier,
} from "../../modules/identity/adapter/outbound/session-verifier";
import type { AuthenticatedRequest } from "./authenticated-request";
import { PUBLIC_ROUTE_KEY } from "./public-route.decorator";

/**
 * SessionVerifier の結果を 通過 / 401 / 403 / 503 へ変換する。
 * unavailable (503) では認証基盤の障害であり未認証ではないため、Cookie を失効させる
 * Set-Cookie は出さない。
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(SESSION_VERIFIER)
    private readonly sessionVerifier: SessionVerifier,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublicRoute = this.reflector.getAllAndOverride<boolean>(
      PUBLIC_ROUTE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isPublicRoute === true) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const result = await this.sessionVerifier.verify(request.headers);

    switch (result.kind) {
      case "authenticated": {
        request.userId = result.userId;
        return true;
      }
      case "unauthenticated": {
        throw new UnauthorizedException({
          code: "UNAUTHENTICATED",
          message: "Authentication required",
        });
      }
      case "forbidden": {
        throw new ForbiddenException({
          code: "FORBIDDEN_NOT_ALLOWED",
          message: "This account is not allowed",
        });
      }
      case "unavailable": {
        throw new ServiceUnavailableException({
          code: "AUTH_UNAVAILABLE",
          message: "Authentication is temporarily unavailable",
        });
      }
    }
  }
}
