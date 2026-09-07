export const AFK_AFTER_MS = 15 * 60 * 1000;
export const AFK_AFTER_SECONDS = AFK_AFTER_MS / 1000;

export type PresenceStatus = "online" | "afk" | "offline";

export function resolvePresenceStatus(
  isOnline: boolean,
  lastActiveAt?: string | null,
  nowMs = Date.now(),
): PresenceStatus {
  if (!isOnline) return "offline";
  if (!lastActiveAt) return "online";
  const elapsed = nowMs - new Date(lastActiveAt).getTime();
  if (!Number.isFinite(elapsed)) return "online";
  return elapsed >= AFK_AFTER_MS ? "afk" : "online";
}
