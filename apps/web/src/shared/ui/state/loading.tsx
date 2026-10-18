import { Skeleton, SkeletonFrame } from "./skeleton";

/**
 * 共通の骨組み（見出し1本とカード2枚）。専用の骨組みを持たない画面で、
 * 取得を待つあいだに出す（設計書 screen-speed のSS-02）。
 */
export function Loading() {
  return (
    <SkeletonFrame className="loading">
      <Skeleton width="45%" height={24} />
      <div className="skeleton-card">
        <Skeleton width="35%" height={12} />
        <Skeleton height={16} />
        <Skeleton width="80%" height={16} />
      </div>
      <div className="skeleton-card">
        <Skeleton width="30%" height={12} />
        <Skeleton width="60%" height={16} />
      </div>
    </SkeletonFrame>
  );
}
