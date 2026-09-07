import type { ReactNode } from "react";

import Skeleton from "./Skeleton";

interface AppShellSkeletonProps {
  children?: ReactNode;
  label?: string;
}

function HeaderTabs({ fullWidth = false }: { fullWidth?: boolean }) {
  return (
    <div className={`pill-group shrink-0 ${fullWidth ? "w-full" : "w-full sm:w-fit"}`}>
      <Skeleton className="h-8 w-14" rounded="lg" />
      <Skeleton className="h-8 w-[4.25rem]" rounded="lg" />
    </div>
  );
}

function HeaderActions() {
  return (
    <>
      <Skeleton className="h-8 w-14" rounded="lg" />
      <Skeleton className="h-7 w-20 sm:w-24" rounded="full" />
      <Skeleton className="h-9 w-9" rounded="full" />
    </>
  );
}

export default function AppShellSkeleton({
  children,
  label = "Loading",
}: AppShellSkeletonProps) {
  return (
    <div className="app-bg" aria-busy="true" aria-label={label}>
      <span className="sr-only" role="status">
        {label}
      </span>
      <header className="app-header">
        <div className="mx-auto flex w-full flex-col gap-2 px-3 py-2.5 sm:px-5 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between lg:gap-x-3 lg:gap-y-2 lg:px-8 xl:px-10">
          <div className="flex w-full min-w-0 items-center justify-between gap-3 lg:flex-1 lg:justify-start">
            <div className="flex shrink-0 items-center gap-2">
              <Skeleton className="h-7 w-7 shrink-0" rounded="lg" />
              <Skeleton className="h-5 w-28" rounded="md" />
            </div>
            <div className="flex shrink-0 items-center gap-2 sm:gap-3 lg:hidden">
              <HeaderActions />
            </div>
            <div className="hidden min-w-0 flex-1 items-center gap-3 lg:flex">
              <span className="hidden h-6 w-px shrink-0 bg-slate-700/80 lg:block" aria-hidden />
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2 lg:gap-x-4">
                <Skeleton className="hidden h-4 w-20 sm:block" rounded="sm" />
                <HeaderTabs />
              </div>
            </div>
          </div>
          <div className="w-full lg:hidden">
            <HeaderTabs fullWidth />
          </div>
          <div className="hidden shrink-0 items-center gap-2 sm:gap-3 lg:flex">
            <HeaderActions />
          </div>
        </div>
      </header>
      <main className="dashboard-main flex min-h-0 w-full flex-1 flex-col px-3 py-3 sm:px-5 sm:py-4 lg:px-8 lg:py-3 xl:px-10">
        {children}
      </main>
      <footer className="app-footer mx-auto flex w-full shrink-0 flex-col gap-2 px-3 pb-5 sm:px-5 lg:px-8 xl:px-10">
        <div className="footer-bar">
          <div className="footer-kofi">
            <Skeleton className="h-8 w-24" rounded="full" />
          </div>
          <div className="flex items-center gap-3">
            <Skeleton className="h-3 w-16" rounded="sm" />
            <Skeleton className="h-3 w-10" rounded="sm" />
            <Skeleton className="h-3 w-14" rounded="sm" />
          </div>
          <div className="footer-download">
            <Skeleton className="h-8 w-28" rounded="full" />
          </div>
        </div>
      </footer>
    </div>
  );
}
