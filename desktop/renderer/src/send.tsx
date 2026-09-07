import { useEffect, useState } from "react";

import type { DesktopState, Friend } from "./desktopApi";
import { Button } from "./ui/components";

const FULLSCREEN_LAYOUT = { x: 0, y: 0, width: 100, height: 100, rotation: 0, objectFit: "contain" };

function basename(filePath: string): string {
  const parts = filePath.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || filePath;
}

export function SendView({ state }: { state: DesktopState }) {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [filePath, setFilePath] = useState<string | null>(null);
  const [soundPath, setSoundPath] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [durationSec, setDurationSec] = useState(3);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);

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
      setFriends((prev) =>
        prev.map((f) =>
          f.user_id === data.userId
            ? {
                ...f,
                is_online: data.isOnline,
                last_active_at: data.isOnline ? (data.lastActiveAt ?? f.last_active_at ?? null) : null,
              }
            : f,
        ),
      );
    });
  }, []);

  const onlineFriends = friends.filter((f) => f.status === "accepted" && f.is_online);
  const selfId = state.userId;
  const selfOnline = Boolean(selfId && state.connected && state.online);
  const hasRecipients = onlineFriends.length > 0 || selfOnline;

  function toggle(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function handleSend() {
    setError("");
    setOk("");
    if (!filePath) {
      setError("Pick a file first");
      return;
    }
    if (selectedIds.length === 0) {
      setError("Select at least one recipient");
      return;
    }
    if (!state.connected) {
      setError("Not connected — reconnect first");
      return;
    }

    setSending(true);
    try {
      const uploads = await window.desktopAPI.uploadMedia({
        receiverIds: selectedIds,
        filePath,
        caption: caption.trim() || undefined,
        soundPath: soundPath || undefined,
      });
      const durationMs = Math.round(Math.min(30, Math.max(2, durationSec)) * 1000);
      for (const upload of uploads) {
        await window.desktopAPI.sendMessage({
          receiverId: upload.receiver_id,
          messageId: upload.message_id,
          durationMs,
          layout: FULLSCREEN_LAYOUT,
        });
      }
      setOk(`Sent to ${uploads.length} recipient${uploads.length === 1 ? "" : "s"}`);
      setFilePath(null);
      setSoundPath(null);
      setCaption("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Send failed");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="panel-view fade-in">
      <div className="send__grid">
        <section className="friends__section">
          <h3 className="friends__title">Media</h3>
          <div className="row">
            <Button
              onClick={() => {
                void window.desktopAPI.pickMedia().then((p) => {
                  if (p) setFilePath(p);
                });
              }}
            >
              Choose file
            </Button>
            {filePath && (
              <Button
                onClick={() => {
                  setFilePath(null);
                  setSoundPath(null);
                }}
              >
                Clear
              </Button>
            )}
          </div>
          <p className="panel-muted">{filePath ? basename(filePath) : "Image, video, or audio"}</p>

          <div className="row" style={{ marginTop: 8 }}>
            <Button
              disabled={!filePath}
              onClick={() => {
                void window.desktopAPI.pickAudio().then((p) => {
                  if (p) setSoundPath(p);
                });
              }}
            >
              Optional sound
            </Button>
            {soundPath && (
              <Button onClick={() => setSoundPath(null)}>
                Clear sound
              </Button>
            )}
          </div>
          {soundPath && <p className="panel-muted">{basename(soundPath)}</p>}

          <label className="field-label" htmlFor="send-caption">
            Caption
          </label>
          <input
            id="send-caption"
            className="field"
            value={caption}
            maxLength={500}
            placeholder="Optional overlay text"
            onChange={(e) => setCaption(e.target.value)}
          />

          <label className="field-label" htmlFor="send-duration">
            Duration (seconds)
          </label>
          <input
            id="send-duration"
            className="field"
            type="number"
            min={2}
            max={30}
            value={durationSec}
            onChange={(e) => setDurationSec(Number(e.target.value) || 8)}
          />
        </section>

        <section className="friends__section">
          <h3 className="friends__title">Recipients</h3>
          {loading ? (
            <p className="panel-muted">Loading…</p>
          ) : !hasRecipients ? (
            <p className="panel-muted">
              {friends.some((f) => f.status === "accepted")
                ? "No friends online — wait for them or send to yourself when connected."
                : "Add friends first, then send when they are online."}
            </p>
          ) : (
            <ul className="friends__list friends__list--scroll">
              {selfOnline && selfId && (
                <li className="friends__row">
                  <label className="send__check">
                    <input type="checkbox" checked={selectedIds.includes(selfId)} onChange={() => toggle(selfId)} />
                    <strong>You</strong>
                    <span className="panel-muted">({state.username})</span>
                  </label>
                </li>
              )}
              {onlineFriends.map((f) => (
                <li key={f.id} className="friends__row">
                  <label className="send__check">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(f.user_id)}
                      onChange={() => toggle(f.user_id)}
                    />
                    <span className="presence presence--online" />
                    <strong>{f.username}</strong>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {error && <p className="panel-error">{error}</p>}
      {ok && <p className="panel-ok">{ok}</p>}

      <Button variant="primary" disabled={sending || !filePath || selectedIds.length === 0} onClick={() => void handleSend()}>
        {sending ? "Sending…" : "Send ping"}
      </Button>
    </div>
  );
}
