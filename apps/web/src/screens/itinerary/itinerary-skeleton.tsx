import { Skeleton, SkeletonFrame } from "@/shared/ui/state/skeleton";

/**
 * しおりの骨組み（設計書 screen-speed のSS-01）。旅行のヘッダー・日付の帯・
 * その日の予定の一覧を、本物と同じクラス名で並べる。
 */
export function ItinerarySkeleton() {
  return (
    <SkeletonFrame as="main" className="itinerary-page">
      <header className="trip-header">
        <div className="trip-header-main">
          <Skeleton width="35%" height={12} />
          <Skeleton width="60%" height={24} />
        </div>
      </header>
      <div className="date-bar">
        <Skeleton height={52} />
      </div>
      <section className="itinerary-list">
        <header className="itinerary-list-head">
          <Skeleton width="40%" height={16} />
        </header>
        <div className="skeleton-stack">
          <Skeleton height={44} />
          <Skeleton height={44} />
          <Skeleton height={44} />
          <Skeleton height={44} />
        </div>
      </section>
    </SkeletonFrame>
  );
}
