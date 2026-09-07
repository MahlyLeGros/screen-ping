import Skeleton from "./Skeleton";

export default function SettingsSkeleton() {
  return (
    <div className="mx-auto max-w-lg space-y-4 pb-4" aria-hidden>
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-6 w-40" rounded="md" />
        <Skeleton className="h-9 w-16 shrink-0" rounded="lg" />
      </div>

      <div className="panel flex items-center gap-3 p-4">
        <Skeleton className="h-12 w-12 shrink-0" rounded="full" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-4 w-32" rounded="sm" />
          <Skeleton className="h-3 w-44 max-w-full" rounded="sm" />
        </div>
      </div>

      <section className="panel space-y-3 p-4">
        <Skeleton className="h-4 w-20" rounded="sm" />
        <Skeleton className="h-10 w-full" rounded="lg" />
        <Skeleton className="h-10 w-full" rounded="lg" />
      </section>

      <section className="panel space-y-3 p-4">
        <Skeleton className="h-4 w-24" rounded="sm" />
        <Skeleton className="h-10 w-full" rounded="lg" />
        <Skeleton className="h-10 w-full" rounded="lg" />
      </section>
    </div>
  );
}
