import { FormEvent, useEffect, useState } from "react";
import { api, Friend } from "../lib/api";
import { applyPresenceUpdate, usePresenceTick } from "../lib/presence";
import { subscribeFriends, subscribePresence } from "../lib/socket";
import { resolvePresenceStatus } from "../../../shared/presence";
import Avatar from "./Avatar";
import Alert from "./Alert";
import EmptyState from "./EmptyState";
import FriendsPanelSkeleton from "./FriendsPanelSkeleton";

interface FriendsPanelProps {
  onFriendsChange?: (friends: Friend[]) => void;
}

export default function FriendsPanel({ onFriendsChange }: FriendsPanelProps) {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [username, setUsername] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const nowMs = usePresenceTick();

  function updateFriends(updater: (prev: Friend[]) => Friend[]) {
    setFriends((prev) => {
      const next = updater(prev);
      onFriendsChange?.(next);
      return next;
    });
  }

  async function loadFriends() {
    try {
      const list = await api.friends();
      updateFriends(() => list);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load friends");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadFriends();
  }, []);

  useEffect(() => {
    return subscribePresence((data) => {
      updateFriends((prev) => applyPresenceUpdate(prev, data));
    });
  }, []);

  useEffect(() => {
    return subscribeFriends(() => {
      void loadFriends();
    });
  }, []);

  async function handleRequest(e: FormEvent) {
    e.preventDefault();
    const name = username.trim();
    if (!name) return;
    setError("");
    setActing(true);
    try {
      await api.requestFriend(name);
      setUsername("");
      await loadFriends();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setActing(false);
    }
  }

  async function withConfirm(action: () => Promise<void>, message: string) {
    if (!window.confirm(message)) return;
    setActing(true);
    try {
      await action();
      await loadFriends();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setActing(false);
    }
  }

  const pending = friends.filter((f) => f.status === "pending");
  const accepted = friends.filter((f) => f.status === "accepted");
  const blocked = friends.filter((f) => f.status === "blocked");

  return (
    <div className="space-y-4">
      <form onSubmit={handleRequest} className="flex gap-2">
        <label className="sr-only" htmlFor="friend-username">
          Friend username
        </label>
        <input
          id="friend-username"
          className="field-input flex-1"
          placeholder="Add friend by username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          disabled={acting}
        />
        <button type="submit" className="btn-primary shrink-0" disabled={acting || !username.trim()}>
          Add
        </button>
      </form>

      {error && <Alert variant="error">{error}</Alert>}

      {loading ? (
        <FriendsPanelSkeleton />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {pending.length > 0 && (
            <section className="form-section lg:col-span-2" aria-label="Pending friend requests">
              <h3 className="form-section-title mb-2">Pending requests</h3>
              <ul className="space-y-1.5">
                {pending.map((f) => (
                  <li key={f.id} className="list-row">
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <Avatar name={f.username} src={f.avatar_url} size="xs" />
                      <span className="truncate font-medium">{f.username}</span>
                      <span className="hidden truncate text-xs text-slate-500 sm:inline">
                        {f.direction === "incoming" ? "wants to be friends" : "request sent"}
                      </span>
                    </div>
                    {f.direction === "incoming" && (
                      <div className="list-row-actions flex shrink-0 gap-1.5">
                        <button
                          type="button"
                          disabled={acting}
                          onClick={() => {
                            setActing(true);
                            void api
                              .acceptFriend(f.id)
                              .then(loadFriends)
                              .catch((err) =>
                                setError(err instanceof Error ? err.message : "Failed"),
                              )
                              .finally(() => setActing(false));
                          }}
                          className="btn-compact"
                        >
                          Accept
                        </button>
                        <button
                          type="button"
                          disabled={acting}
                          onClick={() => void withConfirm(() => api.declineFriend(f.id), `Decline ${f.username}?`)}
                          className="btn-ghost"
                        >
                          Decline
                        </button>
                      </div>
                    )}
                    {f.direction === "outgoing" && (
                      <button
                        type="button"
                        disabled={acting}
                        onClick={() => void withConfirm(() => api.removeFriend(f.id), `Cancel request to ${f.username}?`)}
                        className="btn-ghost list-row-actions shrink-0"
                      >
                        Cancel
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="form-section" aria-label="Your friends">
            <h3 className="form-section-title mb-2">Your friends</h3>
            {accepted.length === 0 ? (
              <EmptyState
                title="No friends yet"
                description="Search by username above — they need a Screen Ping account too."
              />
            ) : (
              <ul className="scroll-area max-h-56 space-y-1.5">
                {accepted.map((f) => {
                  const presence = resolvePresenceStatus(f.is_online, f.last_active_at, nowMs);
                  const statusClass =
                    presence === "online"
                      ? "text-accent-400"
                      : presence === "afk"
                        ? "text-amber-400"
                        : "text-slate-500";
                  const statusLabel =
                    presence === "online" ? "Online" : presence === "afk" ? "AFK" : "Offline";
                  return (
                  <li key={f.id} className="list-row">
                    <div className="flex min-w-0 items-center gap-2">
                      <Avatar
                        name={f.username}
                        src={f.avatar_url}
                        size="xs"
                        presence={presence}
                        lastActiveAt={f.last_active_at}
                      />
                      <span className="truncate font-medium">{f.username}</span>
                      <span className={`text-xs ${statusClass}`}>{statusLabel}</span>
                    </div>
                    <div className="list-row-actions flex shrink-0 gap-1.5">
                      <button
                        type="button"
                        disabled={acting}
                        onClick={() =>
                          void withConfirm(
                            () => api.removeFriend(f.id),
                            `Remove ${f.username} from your friends?`,
                          )
                        }
                        className="btn-ghost"
                      >
                        Remove
                      </button>
                      <button
                        type="button"
                        disabled={acting}
                        onClick={() =>
                          void withConfirm(() => api.blockFriend(f.id), `Block ${f.username}?`)
                        }
                        className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50"
                      >
                        Block
                      </button>
                    </div>
                  </li>
                  );
                })}
              </ul>
            )}
          </section>

          {blocked.length > 0 && (
            <section className="form-section" aria-label="Blocked users">
              <h3 className="form-section-title mb-2">Blocked</h3>
              <ul className="space-y-1.5">
                {blocked.map((f) => (
                  <li key={f.id} className="list-row">
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <Avatar name={f.username} src={f.avatar_url} size="xs" />
                      <span className="truncate font-medium">{f.username}</span>
                    </div>
                    <button
                      type="button"
                      disabled={acting}
                      onClick={() => void withConfirm(() => api.unblockFriend(f.id), `Unblock ${f.username}?`)}
                      className="btn-ghost list-row-actions shrink-0"
                    >
                      Unblock
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
