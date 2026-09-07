import Skeleton, { SkeletonListRow } from "./Skeleton";

export default function FriendsPanelSkeleton() {
  return (
    <div className="space-y-4" aria-hidden>
      <div className="flex gap-2">
        <Skeleton className="h-10 flex-1" rounded="lg" />
        <Skeleton className="h-10 w-16 shrink-0" rounded="lg" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="form-section lg:col-span-2 space-y-2">
          <Skeleton className="h-4 w-32" rounded="sm" />
          <SkeletonListRow />
        </section>
        <section className="form-section space-y-2">
          <Skeleton className="h-4 w-20" rounded="sm" />
          <SkeletonListRow />
          <SkeletonListRow />
          <SkeletonListRow />
        </section>
        <section className="form-section space-y-2">
          <Skeleton className="h-4 w-16" rounded="sm" />
          <SkeletonListRow />
          <SkeletonListRow />
        </section>
      </div>
    </div>
  );
}
