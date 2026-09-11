import { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";

import "./ui/theme.css";
import { StatusDot } from "./ui/components";
import {
  IconClose,
  IconExternal,
  IconPower,
  IconRefresh,
  IconRocket,
  IconSettings,
} from "./ui/icons";
import { useClipState } from "./useClipState";

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
      {hint && (
        <span className={`menu__item-hint${hintTone ? ` menu__item-hint--${hintTone}` : ""}`}>{hint}</span>
      )}
    </button>
  );
}

function Menu() {
  const state = useClipState();
  const rootRef = useRef<HTMLDivElement>(null);
  const lastHeightRef = useRef(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") window.clipAPI.hideMenu();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!state) return;
    const el = rootRef.current;
    if (!el) return;
    let raf = 0;
    const report = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const height = Math.ceil(el.getBoundingClientRect().height);
        if (height > 0 && height !== lastHeightRef.current) {
          lastHeightRef.current = height;
          window.clipAPI.resizeMenu(MENU_WIDTH, height);
        }
      });
    };
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [state]);

  if (!state) {
    return <div className="menu" ref={rootRef} />;
  }

  const running = state.buffer.status === "running";
  const paused = state.buffer.status === "paused";
  const statusText =
    running ? "Buffering" : paused ? "Paused" : state.buffer.status === "error" ? "Error" : "Stopped";
  const dot: "ok" | "warn" | "off" = running ? "ok" : paused || state.buffer.status === "error" ? "warn" : "off";

  return (
    <div className="menu" ref={rootRef}>
      <div className="menu__head">
        <div className="menu__brand">Screen Clip</div>
        <button type="button" className="icon-btn icon-btn--close" onClick={() => window.clipAPI.hideMenu()}>
          <IconClose />
        </button>
      </div>
      <div className="menu__status">
        <StatusDot state={dot} />
        <span>{statusText}</span>
        <span className="menu__status-meta">{state.settings.bufferSeconds}s</span>
      </div>
      {state.buffer.lastError && (
        <div className="menu__error" title={state.buffer.lastError}>
          {state.buffer.lastError}
        </div>
      )}
      <div className="menu__list">
        <MenuItem
          icon={<IconRefresh />}
          label="Save clip"
          hint={state.settings.hotkey.replace("CommandOrControl", "Ctrl")}
          onClick={() => window.clipAPI.action("save-clip")}
        />
        <MenuItem
          icon={<IconPower />}
          label={running ? "Pause buffer" : "Resume buffer"}
          hint={running ? "ON" : "OFF"}
          hintTone={running ? "on" : "warn"}
          onClick={() => window.clipAPI.action(running ? "pause-buffer" : "resume-buffer")}
        />
        <MenuItem icon={<IconSettings />} label="Settings" onClick={() => window.clipAPI.action("open-settings")} />
        <MenuItem
          icon={<IconExternal />}
          label="Open clips folder"
          onClick={() => window.clipAPI.action("open-output-dir")}
        />
        <MenuItem
          icon={<IconRocket />}
          label="Start with Windows"
          hint={state.settings.launchAtLogin ? "ON" : "OFF"}
          hintTone={state.settings.launchAtLogin ? "on" : undefined}
          onClick={() => window.clipAPI.action("toggle-launch-at-login")}
        />
        <MenuItem icon={<IconClose />} label="Quit" danger onClick={() => window.clipAPI.action("quit")} />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Menu />);
