import { Skeleton, SkeletonFrame } from "@/shared/ui/state/skeleton";

/**
 * 記録の一覧の骨組み（設計書 screen-speed のSS-01）。見出しと絞り込みの帯は
 * 本物を先に出しているので、ここでは一覧の行（記録のカード）だけを並べる。
 */
export function RecordListSkeleton() {
  return (
    <SkeletonFrame as="section" className="record-card">
      <div className="skeleton-stack records-skeleton-rows">
        <Skeleton height={40} />
        <Skeleton height={40} />
        <Skeleton height={40} />
        <Skeleton height={40} />
        <Skeleton height={40} />
      </div>
    </SkeletonFrame>
  );
}
