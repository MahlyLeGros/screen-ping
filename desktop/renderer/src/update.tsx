import { createRoot } from "react-dom/client";

import "./ui/theme.css";
import { IconClose } from "./ui/icons";
import type { DesktopState } from "./desktopApi";
import { useDesktopState } from "./useDesktopState";

type Tone = "accent" | "ok" | "danger";

interface Phase {
  title: string;
  detail: string;
  /** null renders the indeterminate sweep instead of a filled bar. */
  percent: number | null;
  tone: Tone;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return `${Math.round(bytes / 1024)} KB`;
  return `${mb.toFixed(1)} MB`;
}

function downloadDetail(update: DesktopState["update"]): string {
  const { transferred, total, bytesPerSecond } = update;
  if (!transferred || !total) return "Starting download…";
  const speed = bytesPerSecond ? ` · ${formatBytes(bytesPerSecond)}/s` : "";
  return `${formatBytes(transferred)} of ${formatBytes(total)}${speed}`;
}

function phaseOf(state: DesktopState): Phase {
  const { update } = state;

  if (!state.packaged) {
    return {
      title: "Updates are disabled",
      detail: "This is a development build.",
      percent: 100,
      tone: "accent",
    };
  }

  switch (update.state) {
    case "checking":
      return { title: "Checking for updates", detail: "Contacting the update server…", percent: null, tone: "accent" };
    case "available":
      return {
        title: `Update ${update.version} found`,
        detail: "Preparing the download…",
        percent: null,
        tone: "accent",
      };
    case "downloading":
      return {
        title: "Downloading update",
        detail: downloadDetail(update),
        percent: update.percent ?? 0,
        tone: "accent",
      };
    case "ready":
      return {
        title: `Version ${update.version} is ready`,
        detail: "Screen Ping will restart to finish installing.",
        percent: 100,
        tone: "ok",
      };
    case "installing":
      return { title: "Installing", detail: "Closing Screen Ping…", percent: null, tone: "ok" };
    case "error":
      return {
        title: "Update failed",
        detail: update.message ?? "Something went wrong. Try again in a moment.",
        percent: 100,
        tone: "danger",
      };
    case "up-to-date":
      return { title: "You're up to date", detail: `Running the latest version.`, percent: 100, tone: "ok" };
    default:
      return state.outdated
        ? {
            title: `Version ${state.latestVersion} is available`,
            detail: "Start the update whenever you're ready.",
            percent: 100,
            tone: "accent",
          }
        : { title: "You're up to date", detail: "Running the latest version.", percent: 100, tone: "ok" };
  }
}

function Updater() {
  const state = useDesktopState();
  if (!state) return <div className="updater" />;

  const phase = phaseOf(state);
  const { update } = state;
  const busy = update.state === "checking" || update.state === "available" || update.state === "downloading";
  const target = update.version ?? state.latestVersion;

  const close = () => window.desktopAPI.close();

  return (
    <div className="updater">
      <div className="updater__top">
        <span className="updater__app">Screen Ping</span>
        <span className="updater__versions">
          <span className="mono">v{state.version}</span>
          {target && target !== state.version && (
            <>
              <span className="updater__arrow">→</span>
              <span className="mono updater__target">v{target}</span>
            </>
          )}
        </span>
        <button type="button" className="updater__close" title="Close" onClick={close}>
          <IconClose />
        </button>
      </div>

      <div className="updater__main">
        <div className="updater__title">{phase.title}</div>

        <div className={`updater__track${phase.percent === null ? " updater__track--sweep" : ""}`}>
          <div
            className={`updater__fill updater__fill--${phase.tone}`}
            style={phase.percent === null ? undefined : { width: `${Math.round(phase.percent)}%` }}
          />
        </div>

        <div className="updater__detail">
          <span>{phase.detail}</span>
          {update.state === "downloading" && (
            <span className="updater__percent">{Math.round(update.percent ?? 0)}%</span>
          )}
        </div>
      </div>

      <div className="updater__actions">
        {update.state === "ready" ? (
          <>
            <button type="button" className="updater__btn" onClick={close}>
              Later
            </button>
            <button
              type="button"
              className="updater__btn updater__btn--primary"
              onClick={() => window.desktopAPI.action("install-update")}
            >
              Restart and install
            </button>
          </>
        ) : update.state === "error" ? (
          <>
            <button type="button" className="updater__btn" onClick={close}>
              Close
            </button>
            <button
              type="button"
              className="updater__btn updater__btn--primary"
              onClick={() => window.desktopAPI.action("check-updates")}
            >
              Try again
            </button>
          </>
        ) : busy ? (
          <button type="button" className="updater__btn" onClick={() => window.desktopAPI.action("cancel-update")}>
            Cancel
          </button>
        ) : update.state === "installing" ? null : (
          <>
            <button type="button" className="updater__btn" onClick={close}>
              Close
            </button>
            {state.outdated && (
              <button
                type="button"
                className="updater__btn updater__btn--primary"
                onClick={() => window.desktopAPI.action("check-updates")}
              >
                Update now
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Updater />);
