import { FormEvent, useEffect, useState } from "react";

import type { Friend, PresenceUpdate } from "./desktopApi";
import { Button } from "./ui/components";

const AFK_AFTER_MS = 15 * 60 * 1000;

type PresenceStatus = "online" | "afk" | "offline";

function resolvePresenceStatus(
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

function applyPresenceUpdate(friends: Friend[], data: PresenceUpdate): Friend[] {
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

function presenceLabel(status: PresenceStatus): string {
  if (status === "online") return "Online";
  if (status === "afk") return "AFK";
  return "Offline";
}

export function FriendsView() {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [username, setUsername] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  async function loadFriends() {
    try {
      const list = await window.desktopAPI.friends.list();
      setFriends(list);
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
    window.desktopAPI.onPresence((data) => {
      setFriends((prev) => applyPresenceUpdate(prev, data));
    });
  }, []);

  useEffect(() => {
    window.desktopAPI.onFriendsUpdate(() => {
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
      await window.desktopAPI.friends.request(name);
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
    <div className="panel-view fade-in">
      <form className="friends__add" onSubmit={handleRequest}>
        <input
          className="field"
          placeholder="Add friend by username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          disabled={acting}
        />
        <Button type="submit" variant="primary" disabled={acting || !username.trim()}>
          Add
        </Button>
      </form>

      {error && <p className="panel-error">{error}</p>}

      {loading ? (
        <p className="panel-muted">Loading friends…</p>
      ) : (
        <div className="friends__sections">
          {pending.length > 0 && (
            <section className="friends__section">
              <h3 className="friends__title">Pending</h3>
              <ul className="friends__list">
                {pending.map((f) => (
                  <li key={f.id} className="friends__row">
                    <div className="friends__meta">
                      <strong>{f.username}</strong>
                      <span className="panel-muted">
                        {f.direction === "incoming" ? "wants to be friends" : "request sent"}
                      </span>
                    </div>
                    {f.direction === "incoming" && (
                      <div className="row">
                        <Button
                          disabled={acting}
                          onClick={() => {
                            setActing(true);
                            void window.desktopAPI.friends
                              .accept(f.id)
                              .then(loadFriends)
                              .catch((err) => setError(err instanceof Error ? err.message : "Failed"))
                              .finally(() => setActing(false));
                          }}
                        >
                          Accept
                        </Button>
                        <Button
                          disabled={acting}
                          onClick={() => void withConfirm(() => window.desktopAPI.friends.decline(f.id).then(() => undefined), `Decline ${f.username}?`)}
                        >
                          Decline
                        </Button>
                      </div>
                    )}
                    {f.direction === "outgoing" && (
                      <Button
                        disabled={acting}
                        onClick={() =>
                          void withConfirm(
                            () => window.desktopAPI.friends.remove(f.id).then(() => undefined),
                            `Cancel request to ${f.username}?`,
                          )
                        }
                      >
                        Cancel
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="friends__section">
            <h3 className="friends__title">Your friends</h3>
            {accepted.length === 0 ? (
              <p className="panel-muted">No friends yet — add someone by username above.</p>
            ) : (
              <ul className="friends__list friends__list--scroll">
                {accepted.map((f) => {
                  const presence = resolvePresenceStatus(f.is_online, f.last_active_at, nowMs);
                  return (
                    <li key={f.id} className="friends__row">
                      <div className="friends__meta">
                        <span className={`presence presence--${presence}`} />
                        <strong>{f.username}</strong>
                        <span className="panel-muted">{presenceLabel(presence)}</span>
                      </div>
                      <div className="row">
                        <Button
                          disabled={acting}
                          onClick={() =>
                            void withConfirm(
                              () => window.desktopAPI.friends.remove(f.id).then(() => undefined),
                              `Remove ${f.username}?`,
                            )
                          }
                        >
                          Remove
                        </Button>
                        <Button
                          variant="danger"
                          disabled={acting}
                          onClick={() =>
                            void withConfirm(
                              () => window.desktopAPI.friends.block(f.id).then(() => undefined),
                              `Block ${f.username}?`,
                            )
                          }
                        >
                          Block
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {blocked.length > 0 && (
            <section className="friends__section">
              <h3 className="friends__title">Blocked</h3>
              <ul className="friends__list">
                {blocked.map((f) => (
                  <li key={f.id} className="friends__row">
                    <strong>{f.username}</strong>
                    <Button
                      disabled={acting}
                      onClick={() =>
                        void withConfirm(
                          () => window.desktopAPI.friends.unblock(f.id).then(() => undefined),
                          `Unblock ${f.username}?`,
                        )
                      }
                    >
                      Unblock
                    </Button>
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
