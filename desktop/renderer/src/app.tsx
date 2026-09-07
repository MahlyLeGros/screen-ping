import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import "./ui/theme.css";
import { Button, Card, MonitorPicker, StatusDot, TitleBar, Toggle } from "./ui/components";
import { IconExternal, IconLogout, IconRefresh, IconCoffee } from "./ui/icons";
import type { AppTab, DesktopState } from "./desktopApi";
import { useDesktopState } from "./useDesktopState";
import { FriendsView } from "./friends";
import { SendView } from "./send";

function connectionLabel(state: DesktopState): { text: string; dot: "ok" | "warn" | "off" } {
  if (!state.online) return { text: "Offline", dot: "off" };
  if (!state.connected) return { text: "Connecting…", dot: "warn" };
  if (state.paused) return { text: "Connected · paused", dot: "warn" };
  return { text: "Connected", dot: "ok" };
}

function updateLine(state: DesktopState): string {
  const { update } = state;
  switch (update.state) {
    case "checking":
      return "Checking…";
    case "available":
    case "downloading":
      return "Updating…";
    case "ready":
      return "Restart to update";
    case "installing":
      return "Installing…";
    case "error":
      return "Check failed";
    default:
      return state.outdated ? `${state.latestVersion} available` : "Up to date";
  }
}

/** Progress lives in the update window; the banner only offers the entry point. */
function UpdateBanner({ state }: { state: DesktopState }) {
  const { update } = state;
  const ready = update.state === "ready";
  if (!state.outdated && !ready) return null;

  const target = update.version ?? state.latestVersion ?? "";

  return (
    <div className="banner">
      <span className="banner__version">v{state.version}</span>
      <span className="banner__arrow">to</span>
      <span className="banner__version">v{target}</span>
      <button
        type="button"
        className="banner__btn"
        disabled={update.state === "installing"}
        onClick={() => window.desktopAPI.action(ready ? "install-update" : "check-updates")}
      >
        {ready ? "Restart to update" : "Update now"}
      </button>
    </div>
  );
}

function CompactView({ state }: { state: DesktopState }) {
  const status = connectionLabel(state);
  const display = state.displays.find(
    (d) => d.id === state.overlayDisplayId || (state.overlayDisplayId === null && d.primary),
  );

  const cycleDisplay = () => {
    if (state.displays.length < 2) return;
    const index = state.displays.findIndex((d) => d.id === display?.id);
    const next = state.displays[(index + 1) % state.displays.length];
    window.desktopAPI.set("overlayDisplayId", next.id);
  };

  return (
    <div className="compact fade-in">
      <span className="pill pill--static">
        <StatusDot state={status.dot} />
        {status.text}
      </span>
      <button type="button" className="pill" onClick={() => window.desktopAPI.set("online", !state.online)}>
        Online
        <span className="pill__sep" />
        <span className="pill__meta">{state.online ? "ON" : "OFF"}</span>
      </button>
      <button type="button" className="pill" onClick={() => window.desktopAPI.set("paused", !state.paused)}>
        Pings
        <span className="pill__sep" />
        <span className="pill__meta">{state.paused ? "PAUSED" : "ON"}</span>
      </button>
      <button
        type="button"
        className={state.displays.length > 1 ? "pill" : "pill pill--static"}
        title={display?.label}
        onClick={cycleDisplay}
      >
        {display?.shortLabel ?? "Monitor"}
        <span className="pill__sep" />
        <span className="pill__meta">
          {display ? `${display.bounds.width}×${display.bounds.height}` : ""}
        </span>
      </button>
      <button type="button" className="pill" onClick={() => window.desktopAPI.action("reconnect")}>
        Reconnect
      </button>
    </div>
  );
}

function ReceiveView({ state }: { state: DesktopState }) {
  const status = connectionLabel(state);
  const selectedDisplay =
    state.overlayDisplayId ?? state.displays.find((d) => d.primary)?.id ?? state.displays[0]?.id ?? 0;

  return (
    <div className="grid fade-in">
      <Card
        title="Connection"
        control={<Toggle value={state.online} onChange={(v) => window.desktopAPI.set("online", v)} green />}
      >
        <div className="status-line">
          <StatusDot state={status.dot} />
          <strong>{status.text}</strong>
          {state.username && <span>· {state.username}</span>}
        </div>
        <Button icon={<IconRefresh />} onClick={() => window.desktopAPI.action("reconnect")}>
          Reconnect now
        </Button>
      </Card>

      <Card title="Show pings on">
        {state.displays.length > 1 ? (
          <>
            <MonitorPicker
              displays={state.displays}
              value={selectedDisplay}
              onChange={(id) => window.desktopAPI.set("overlayDisplayId", id)}
            />
            <p className="card__desc">Pick the monitor where the overlay appears.</p>
          </>
        ) : (
          <p className="card__desc">Only one monitor detected.</p>
        )}
      </Card>

      <Card
        title="Incoming pings"
        control={
          <Toggle
            value={!state.paused}
            onChange={(v) => window.desktopAPI.set("paused", !v)}
            labels={["PAUSED", "ON"]}
            green
          />
        }
        disabled={state.paused}
      >
        <div className="status-line">
          <StatusDot state={state.paused ? "warn" : "ok"} />
          <strong>{state.paused ? "Paused" : "Receiving"}</strong>
        </div>
        <p className="card__desc">Paused pings are acknowledged but never shown.</p>
      </Card>

      <Card
        title="Start with Windows"
        control={
          <Toggle
            value={state.launchAtLogin}
            onChange={(v) => window.desktopAPI.set("launchAtLogin", v)}
            green
          />
        }
      >
        <div className="status-line">
          <StatusDot state={state.launchAtLogin ? "ok" : "off"} />
          <strong>{state.launchAtLogin ? "Enabled" : "Disabled"}</strong>
        </div>
        <p className="card__desc">Launches quietly in the tray when you sign in.</p>
      </Card>

      <Card title="Account">
        <div className="status-line">
          <strong>{state.username ?? "Signed in"}</strong>
          <span className="mono">{state.serverUrl.replace(/^https?:\/\//, "")}</span>
        </div>
        <div className="row">
          <Button icon={<IconExternal />} onClick={() => window.desktopAPI.action("open-dashboard")}>
            Web dashboard
          </Button>
          <Button icon={<IconLogout />} variant="danger" onClick={() => window.desktopAPI.action("logout")}>
            Log out
          </Button>
        </div>
      </Card>

      <Card title="About">
        <div className="status-line">
          <span className="mono">Version {state.version}</span>
          <span>· {updateLine(state)}</span>
        </div>
        <Button icon={<IconCoffee />} variant="primary" onClick={() => window.desktopAPI.action("open-kofi")}>
          Support on Ko-fi
        </Button>
        <div className="row">
          <Button
            onClick={() =>
              window.desktopAPI.action(state.update.state === "ready" ? "install-update" : "check-updates")
            }
            disabled={state.update.state === "installing"}
          >
            {state.update.state === "ready" ? "Restart to update" : "Check for updates"}
          </Button>
          <Button variant="danger" onClick={() => window.desktopAPI.action("quit")}>
            Quit Screen Ping
          </Button>
        </div>
      </Card>
    </div>
  );
}

function App() {
  const state = useDesktopState();
  const bodyRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<AppTab>("receive");
  const bannerVisible = Boolean(state && (state.outdated || state.update.state === "ready"));

  useEffect(() => {
    window.desktopAPI.onOpenTab((next) => {
      if (next === "receive" || next === "friends" || next === "send") setTab(next);
    });
  }, []);

  useEffect(() => {
    if (!state?.compact) return;
    const el = bodyRef.current;
    if (!el) return;

    let raf = 0;
    const reportSize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const offsetAbove = el.getBoundingClientRect().top;
        window.desktopAPI.resizeToContent(Math.ceil(offsetAbove + el.scrollHeight) + 2);
      });
    };

    reportSize();
    const observer = new ResizeObserver(reportSize);
    observer.observe(el);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [state?.compact]);

  /**
   * One shot per view/banner change. Receive grid measures equal rows; Friends/Send
   * use natural content height. Views switch only via the tray menu.
   */
  useEffect(() => {
    if (!state || state.compact) return;
    const el = bodyRef.current;
    if (!el) return;

    const raf = requestAnimationFrame(() => {
      const bodyStyle = getComputedStyle(el);
      const padding = parseFloat(bodyStyle.paddingTop) + parseFloat(bodyStyle.paddingBottom);
      const top = el.getBoundingClientRect().top;

      if (tab === "receive") {
        const grid = el.querySelector<HTMLElement>(".grid");
        if (!grid) return;

        grid.classList.add("grid--measure");
        const rowHeights = Array.from(grid.children, (card) => card.getBoundingClientRect().height);
        grid.classList.remove("grid--measure");
        if (!rowHeights.length) return;

        const gridStyle = getComputedStyle(grid);
        const gap = parseFloat(gridStyle.rowGap) || 0;
        const tallest = Math.max(...rowHeights);
        const natural = tallest * 3 + gap * 2;
        window.desktopAPI.resizeToContent(Math.ceil(top + padding + natural));
        return;
      }

      window.desktopAPI.resizeToContent(Math.ceil(top + padding + el.scrollHeight));
    });

    return () => cancelAnimationFrame(raf);
  }, [state?.compact, bannerVisible, tab]);

  if (!state) return null;

  const compact = state.compact;
  const title =
    tab === "friends" ? "Friends" : tab === "send" ? "Send a ping" : "Screen Ping";

  return (
    <div className="app-shell">
      <TitleBar
        title={title}
        onMinimize={() => window.desktopAPI.minimize()}
        onClose={() => window.desktopAPI.close()}
      />

      <UpdateBanner state={state} />

      <div className={compact ? "" : "app-body app-body--full"} ref={bodyRef}>
        {compact ? (
          <CompactView state={state} />
        ) : tab === "friends" ? (
          <FriendsView />
        ) : tab === "send" ? (
          <SendView state={state} />
        ) : (
          <ReceiveView state={state} />
        )}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
