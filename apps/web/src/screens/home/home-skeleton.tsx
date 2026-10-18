import type { Trip } from "@tomotabi/contracts";
import { Skeleton, SkeletonFrame } from "@/shared/ui/state/skeleton";

/**
 * 骨組みに予定のカードを出すか。ホームは、終了した旅行と期間を過ぎた旅行では
 * 予定のカードを出さず、精算を先に置く。旅行がキャッシュにあればその状態で決め、
 * 無ければ（初めて開くとき）出す（旅行中にいちばんよく開くため）。
 */
export function scheduleExpectedFor(
  trip: Pick<Trip, "status" | "endsOn"> | null,
  today: string,
): boolean {
  if (trip === null) {
    return true;
  }
  return trip.status !== "finished" && trip.endsOn >= today;
}

function ScheduleCardSkeleton() {
  return (
    <section className="home-card">
      <header className="home-card-head">
        <Skeleton width="30%" height={16} />
      </header>
      <div className="home-card-body skeleton-stack">
        <Skeleton height={20} />
        <Skeleton height={20} />
        <Skeleton height={20} />
      </div>
    </section>
  );
}

/**
 * ホームの骨組み（設計書 screen-speed のSS-01）。本物のホームと同じ外側の要素と
 * クラス名（ヘッダー・日のバー・予定のカード・精算・最近の記録）を使い、
 * 読み込み後に同じ場所へ中身が入るようにする。
 */
export function HomeSkeleton({ showSchedule = true }: { showSchedule?: boolean }) {
  return (
    <SkeletonFrame as="main" className="home-page">
      <header className="home-header">
        <div className="home-header-main">
          <Skeleton width="40%" height={12} />
          <Skeleton width="65%" height={26} />
        </div>
      </header>
      <div className="home-bars">
        <Skeleton height={4} />
      </div>
      {showSchedule && <ScheduleCardSkeleton />}
      <section className="home-settle">
        <Skeleton width="44px" height={44} />
        <span className="home-settle-main skeleton-stack">
          <Skeleton width="30%" height={12} />
          <Skeleton width="55%" height={22} />
        </span>
      </section>
      <section className="home-card">
        <header className="home-card-head">
          <Skeleton width="30%" height={16} />
        </header>
        <div className="home-card-body skeleton-stack">
          <Skeleton height={20} />
          <Skeleton height={20} />
          <Skeleton height={20} />
        </div>
      </section>
    </SkeletonFrame>
  );
}
