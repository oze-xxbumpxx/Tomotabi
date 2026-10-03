import { SetMetadata, type CustomDecorator } from "@nestjs/common";

export const PUBLIC_ROUTE_KEY = "publicRoute";

/**
 * SessionGuardの検証を受けない公開経路に付ける（/api/healthなど）。
 */
export const PublicRoute = (): CustomDecorator<string> =>
  SetMetadata(PUBLIC_ROUTE_KEY, true);
