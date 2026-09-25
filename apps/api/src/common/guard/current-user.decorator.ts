import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { UserId } from "../domain/user-id";
import type { AuthenticatedRequest } from "./authenticated-request";

/**
 * SessionGuard が検証して request に載せた UserId を取り出す。
 * @PublicRoute の経路では値が存在しないため、非公開経路でだけ使う。
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): UserId => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    return request.userId;
  },
);
