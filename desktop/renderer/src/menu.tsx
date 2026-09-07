import { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";

import "./ui/theme.css";
import { MonitorPicker, StatusDot } from "./ui/components";
import {
  IconBell,
  IconCoffee,
  IconDownload,
  IconExternal,
  IconLogout,
  IconPower,
  IconRefresh,
  IconRocket,
  IconClose,
} from "./ui/icons";
import type { ActionName, DesktopState, SettingKey } from "./desktopApi";
import { useDesktopState } from "./useDesktopState";

const MENU_WIDTH = 262;

function MenuItem({
  icon,
  label,
  hint,
  hintTone,
  danger,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  hintTone?: "on" | "warn";
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className={`menu__item${danger ? " menu__item--danger" : ""}`} onClick={onClick}>
      <span className="menu__item-icon">{icon}</span>
      <span className="menu__item-text">{label}</span>
      {hint && <span className={`menu__item-hint${hintTone ? ` menu__item-hint--${hintTone}` : ""}`}>{hint}</span>}
    </button>
  );
}

function statusOf(state: DesktopState): { text: string; dot: "ok" | "warn" | "off" } {
  if (!state.online) return { text: "Offline", dot: "off" };
  if (!state.connected) return { text: "Connecting…", dot: "warn" };
  if (state.paused) return { text: "Connected · paused", dot: "warn" };
  return { text: "Connected", dot: "ok" };
}

function Menu() {
  const state = useDesktopState();
  const rootRef = useRef<HTMLDivElement>(null);
  const lastHeightRef = useRef(0);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") window.desktopAPI.hideMenu();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!state) return;
    const el = rootRef.current;
    if (!el) return;

    let raf = 0;
    const reportSize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const height = Math.ceil(el.getBoundingClientRect().height);
        if (height > 0 && height !== lastHeightRef.current) {
          lastHeightRef.current = height;
          window.desktopAPI.resizeMenu(MENU_WIDTH, height);
        }
      });
    };

    reportSize();
    const observer = new ResizeObserver(reportSize);
    observer.observe(el);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [state?.displays.length, state?.outdated, state?.update.state, state?.launchAtLogin]);
  if (!state) {
    return <div className="menu menu--loading" ref={rootRef} aria-hidden />;
  }

  const status = statusOf(state);
  const selectedDisplay =
    state.overlayDisplayId ?? state.displays.find((d) => d.primary)?.id ?? state.displays[0]?.id ?? 0;

  const run = (name: ActionName) => {
    window.desktopAPI.action(name);
    window.desktopAPI.hideMenu();
  };
  const set = (key: SettingKey, value: boolean | number | null, keepOpen = true) => {
    window.desktopAPI.set(key, value);
    if (!keepOpen) window.desktopAPI.hideMenu();
  };

  const updateReady = state.update.state === "ready";
  const showUpdate = state.outdated || updateReady;

  return (
    <div className="menu" ref={rootRef}>
      <div className="menu__header">
        <StatusDot state={status.dot} />
        <span className="menu__header-text">
          <span className="menu__status">{status.text}</span>
          <span className="menu__user">{state.username ?? state.serverUrl.replace(/^https?:\/\//, "")}</span>
        </span>
      </div>

      {showUpdate && (
        <button type="button" className="menu__update" onClick={() => run(updateReady ? "install-update" : "check-updates")}>
          {updateReady ? `Restart to update to v${state.update.version}` : `Update to v${state.latestVersion}`}
        </button>
      )}

      <div className="menu__sep" />

      <MenuItem
        icon={<IconPower />}
        label="Online"
        hint={state.online ? "ON" : "OFF"}
        hintTone={state.online ? "on" : undefined}
        onClick={() => set("online", !state.online)}
      />
      <MenuItem
        icon={<IconBell />}
        label="Incoming pings"
        hint={state.paused ? "PAUSED" : "ON"}
        hintTone={state.paused ? "warn" : "on"}
        onClick={() => set("paused", !state.paused)}
      />
      <MenuItem
        icon={<IconRocket />}
        label="Start with Windows"
        hint={state.launchAtLogin ? "ON" : "OFF"}
        hintTone={state.launchAtLogin ? "on" : undefined}
        onClick={() => set("launchAtLogin", !state.launchAtLogin)}
      />
      <MenuItem icon={<IconRefresh />} label="Reconnect" onClick={() => run("reconnect")} />

      {state.displays.length > 1 && (
        <>
          <div className="menu__sep" />
          <div className="menu__label">Show pings on</div>
          <div className="menu__displays">
            <MonitorPicker
              compact
              displays={state.displays}
              value={selectedDisplay}
              onChange={(id) => set("overlayDisplayId", id)}
            />
          </div>
        </>
      )}

      <div className="menu__sep" />

      <MenuItem
        icon={<IconDownload />}
        label="Check for updates"
        hint={`v${state.version}`}
        onClick={() => run("check-updates")}
      />
      <MenuItem icon={<IconExternal />} label="Open web dashboard" onClick={() => run("open-dashboard")} />
      <MenuItem icon={<IconCoffee />} label="Support on Ko-fi" onClick={() => run("open-kofi")} />
      <MenuItem icon={<IconLogout />} label="Log out" onClick={() => run("logout")} />

      <div className="menu__sep" />

      <MenuItem icon={<IconClose />} label="Quit Screen Ping" danger onClick={() => run("quit")} />
    </div>
  );
}

document.body.classList.add("menu-body");
createRoot(document.getElementById("root")!).render(<Menu />);
