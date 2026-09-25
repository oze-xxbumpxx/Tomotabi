import type { Request } from "express";
import type { UserId } from "../domain/user-id";

/**
 * SessionGuard が通過を許した要求。userId には検証済みの値が必ず設定されている。
 */
export interface AuthenticatedRequest extends Request {
  userId: UserId;
}
