import type { Friend, User } from "../lib/api";
import { usePresenceTick } from "../lib/presence";
import { resolvePresenceStatus } from "../../../shared/presence";
import Avatar from "./Avatar";

interface FriendPickerProps {
  friends: Friend[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  currentUser?: User | null;
  compact?: boolean;
  iconsOnly?: boolean;
  /** Stack recipients in a single vertical column (e.g. Draw To panel). */
  stack?: boolean;
}

function presenceLabel(isOnline: boolean, lastActiveAt?: string | null, nowMs?: number): string {
  const status = resolvePresenceStatus(isOnline, lastActiveAt, nowMs);
  if (status === "online") return "Online";
  if (status === "afk") return "AFK";
  return "Offline";
}

export default function FriendPicker({ friends, selectedIds, onChange, currentUser, compact = false, iconsOnly = false, stack = false }: FriendPickerProps) {
  const nowMs = usePresenceTick();
  const onlineFriends = friends.filter((f) => f.status === "accepted" && f.is_online);
  const selfOnline = Boolean(currentUser?.is_desktop_online);
  const hasRecipients = onlineFriends.length > 0 || selfOnline;

  function toggle(userId: string) {
    if (selectedIds.includes(userId)) {
      onChange(selectedIds.filter((id) => id !== userId));
    } else {
      onChange([...selectedIds, userId]);
    }
  }

  if (!hasRecipients) {
    const hasFriends = friends.some((f) => f.status === "accepted");
    return (
      <p className="text-xs text-amber-400/90">
        {hasFriends
          ? "No friends online — open the desktop app to test on yourself, or wait for friends."
          : "Add friends first, or open the desktop app to send yourself a test ping."}
      </p>
    );
  }

  return (
    <div className={compact ? "min-w-0 flex-1" : undefined}>
      {!compact && (
        <div className="mb-1.5">
          <span className="text-xs text-slate-500">
            {selectedIds.length === 0
              ? "Tap to choose recipients"
              : `${selectedIds.length} selected`}
          </span>
        </div>
      )}
      <div
        className={`flex ${stack ? "flex-col flex-nowrap items-stretch" : "flex-wrap"} ${compact ? "h-full gap-2" : "gap-2"} ${compact && !stack ? "items-stretch" : ""}`}
      >
        {currentUser && selfOnline && (
          <button
            type="button"
            onClick={() => toggle(currentUser.id)}
            aria-pressed={selectedIds.includes(currentUser.id)}
            title={`${currentUser.username} (test on yourself)`}
            className={`friend-tile ${compact ? "friend-tile-compact" : ""} ${selectedIds.includes(currentUser.id) ? "friend-tile-selected" : ""}`}
          >
            <Avatar
              name={currentUser.username}
              src={currentUser.avatar_url}
              size={stack ? "xl" : compact ? "md" : "lg"}
              presence="online"
            />
            <span className={iconsOnly ? "sr-only" : "friend-tile-name"}>You (test)</span>
          </button>
        )}
        {onlineFriends.map((f) => {
          const selected = selectedIds.includes(f.user_id);
          const presence = resolvePresenceStatus(f.is_online, f.last_active_at, nowMs);
          return (
            <button
              key={f.user_id}
              type="button"
              onClick={() => toggle(f.user_id)}
              aria-pressed={selected}
              title={`${f.username} — ${presenceLabel(f.is_online, f.last_active_at, nowMs)}`}
              className={`friend-tile ${compact ? "friend-tile-compact" : ""} ${selected ? "friend-tile-selected" : ""}`}
            >
              <Avatar
                name={f.username}
                src={f.avatar_url}
                size={stack ? "xl" : compact ? "md" : "lg"}
                presence={presence}
                lastActiveAt={f.last_active_at}
              />
              <span className={iconsOnly ? "sr-only" : "friend-tile-name"}>{f.username}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
