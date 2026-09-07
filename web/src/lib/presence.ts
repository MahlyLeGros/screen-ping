import { useEffect, useState } from "react";

/** Re-render periodically so AFK status updates without a new socket event. */
export function usePresenceTick(intervalMs = 30_000): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return tick;
}

export function applyPresenceUpdate<T extends { user_id: string; is_online: boolean; last_active_at?: string | null }>(
  friends: T[],
  data: { userId: string; isOnline: boolean; lastActiveAt?: string | null },
): T[] {
  return friends.map((f) =>
    f.user_id === data.userId
      ? {
          ...f,
          is_online: data.isOnline,
          last_active_at: data.isOnline ? (data.lastActiveAt ?? f.last_active_at ?? null) : null,
        }
      : f,
  );
}
