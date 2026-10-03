import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { UserId } from "../domain/user-id";
import type { AuthenticatedRequest } from "./authenticated-request";

/**
 * SessionGuardが検証してrequestに載せたUserIdを取り出す。
 * @PublicRouteの経路では値が存在しないため、非公開経路でだけ使う。
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): UserId => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    return request.userId;
  },
);
