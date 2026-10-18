import { Skeleton, SkeletonFrame } from "@/shared/ui/state/skeleton";

/** 精算額のカードの骨組み。精算の画面で、精算額を待つあいだに出す。 */
export function TransferCardSkeleton() {
  return (
    <section className="settle-card" aria-hidden="true">
      <Skeleton width="45%" height={14} />
      <Skeleton width="60%" height={32} />
      <Skeleton width="35%" height={12} />
      <Skeleton height={48} />
    </section>
  );
}

/**
 * 精算の画面の骨組み（設計書 screen-speed のSS-01）。見出し・精算額のカード・
 * 履歴の見出しを、本物と同じクラス名で並べる。
 */
export function SettlementSkeleton() {
  return (
    <SkeletonFrame as="main" className="settle-page">
      <Skeleton width="25%" height={28} />
      <TransferCardSkeleton />
      <Skeleton width="30%" height={16} />
    </SkeletonFrame>
  );
}
