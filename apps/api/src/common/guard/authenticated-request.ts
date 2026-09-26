import type { Request } from "express";
import type { UserId } from "../domain/user-id";

/**
 * SessionGuard が通過を許した要求。userId と sessionExpiresAt には
 * 検証済みの値が必ず設定されている（/api/me がそのまま返す）。
 */
export interface AuthenticatedRequest extends Request {
  userId: UserId;
  sessionExpiresAt: Date;
}
