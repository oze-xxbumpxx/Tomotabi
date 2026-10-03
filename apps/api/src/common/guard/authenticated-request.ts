import type { Request } from "express";
import type { UserId } from "../domain/user-id";

/**
 * SessionGuardが通過を許した要求。userIdとsessionExpiresAtには
 * 検証済みの値が必ず設定されている（/api/meがそのまま返す）。
 */
export interface AuthenticatedRequest extends Request {
  userId: UserId;
  sessionExpiresAt: Date;
}
