import type { Request } from "express";
import type { UserId } from "../domain/user-id";

/**
 * SessionGuardが通過を許した要求。userId・sessionId・
 * sessionExpiresAtには検証済みの値が必ず設定されている
 * （/api/meがそのまま返す。sessionIdはidentity.sessionsのidで、
 * 購読の登録セッション記録などに使う）。
 */
export interface AuthenticatedRequest extends Request {
  userId: UserId;
  sessionId: string;
  sessionExpiresAt: Date;
}
