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

/**
 * 記録の画面全体の骨組み。直接開いたとき、問い合わせを読む前（Suspenseの待ち）に出す。
 * 読み込み中の本物の画面（見出し・絞り込み・一覧の骨組み）と同じ並びにして、
 * 骨組みどうしが入れ替わって動かないようにする。
 */
export function RecordsPageSkeleton() {
  return (
    <main className="records-page">
      <h1 className="page-title">履歴</h1>
      <div className="record-filters" aria-hidden="true">
        <Skeleton width="64px" height={36} />
        <Skeleton width="64px" height={36} />
        <Skeleton width="64px" height={36} />
        <Skeleton width="64px" height={36} />
      </div>
      <RecordListSkeleton />
    </main>
  );
}
