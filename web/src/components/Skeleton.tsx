import type { HTMLAttributes } from "react";

type SkeletonRounded = "none" | "sm" | "md" | "lg" | "xl" | "full";

const ROUNDED: Record<SkeletonRounded, string> = {
  none: "",
  sm: "rounded",
  md: "rounded-md",
  lg: "rounded-lg",
  xl: "rounded-xl",
  full: "rounded-full",
};

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  rounded?: SkeletonRounded;
}

export default function Skeleton({ className = "", rounded = "md", ...props }: SkeletonProps) {
  return (
    <div
      className={`skeleton ${ROUNDED[rounded]} ${className}`.trim()}
      aria-hidden
      {...props}
    />
  );
}

export function SkeletonText({ lines = 3, className = "" }: { lines?: number; className?: string }) {
  return (
    <div className={`space-y-2 ${className}`.trim()} aria-hidden>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton
          key={i}
          className={`h-3 ${i === lines - 1 ? "w-4/5" : "w-full"}`}
          rounded="sm"
        />
      ))}
    </div>
  );
}

export function SkeletonListRow({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2 ${className}`.trim()} aria-hidden>
      <Skeleton className="h-8 w-8 shrink-0" rounded="full" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <Skeleton className="h-3 w-2/3" rounded="sm" />
        <Skeleton className="h-2.5 w-1/2" rounded="sm" />
      </div>
      <Skeleton className="h-7 w-14 shrink-0" rounded="lg" />
    </div>
  );
}
