import { SetMetadata, type CustomDecorator } from "@nestjs/common";

export const PUBLIC_ROUTE_KEY = "publicRoute";

/**
 * SessionGuard の検証を受けない公開経路に付ける（/api/health など）。
 */
export const PublicRoute = (): CustomDecorator<string> =>
  SetMetadata(PUBLIC_ROUTE_KEY, true);
