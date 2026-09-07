import type { PresenceStatus } from "../../../shared/presence";
import { resolvePresenceStatus } from "../../../shared/presence";

const SIZES = {
  xs: "size-7 text-[10px]",
  sm: "size-9 text-xs",
  md: "size-11 text-sm",
  lg: "size-14 text-base",
  xl: "size-16 text-lg",
} as const;

export type AvatarSize = keyof typeof SIZES;

export function resolveMediaUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("http")) return url;
  return url;
}

interface AvatarProps {
  name: string;
  src?: string | null;
  size?: AvatarSize;
  className?: string;
  /** @deprecated use `presence` */
  online?: boolean;
  presence?: PresenceStatus;
  lastActiveAt?: string | null;
}

const DOT_CLASS: Record<PresenceStatus, string> = {
  online: "online-dot",
  afk: "afk-dot",
  offline: "bg-slate-600",
};

export default function Avatar({
  name,
  src,
  size = "md",
  className = "",
  online,
  presence,
  lastActiveAt,
}: AvatarProps) {
  const resolved = resolveMediaUrl(src);
  const initial = (name.trim()[0] || "?").toUpperCase();
  const status: PresenceStatus | undefined =
    presence ??
    (online === undefined ? undefined : resolvePresenceStatus(online, lastActiveAt));

  return (
    <div className={`relative shrink-0 rounded-full ${SIZES[size]} ${className}`}>
      <div className="flex size-full items-center justify-center overflow-hidden rounded-full bg-slate-800 font-semibold text-slate-300">
        {resolved ? (
          <img src={resolved} alt="" className="block size-full object-cover" draggable={false} />
        ) : (
          initial
        )}
      </div>
      {status !== undefined && (
        <span
          className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-slate-900 ${DOT_CLASS[status]}`}
          aria-hidden
        />
      )}
    </div>
  );
}

export { resolvePresenceStatus };
