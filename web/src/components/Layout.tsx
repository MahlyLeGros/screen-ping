import { useEffect, useState, type KeyboardEvent } from "react";
import { Link, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import AppShellSkeleton from "./AppShellSkeleton";
import DashboardSkeleton from "./DashboardSkeleton";
import SkipLink from "./SkipLink";
import { DashboardChromeProvider, useDashboardChromeOptional } from "../context/DashboardChromeContext";
import { api, ensureAuthBootstrapped, logoutSession } from "../lib/api";
import { subscribePresence, subscribeSocketConnection } from "../lib/socket";
import LegalLinks from "./LegalLinks";
import SupportKofi from "./SupportKofi";
import { DownloadDesktopPill } from "./SupportAndDownload";
import ProfileAvatarButton from "./ProfileAvatarButton";

function HeaderStatus() {
  const [socketOk, setSocketOk] = useState(false);
  const [checking, setChecking] = useState(true);
  const [desktopOn, setDesktopOn] = useState(false);
  const [meId, setMeId] = useState<string | null>(null);

  useEffect(() => {
    return subscribeSocketConnection((isConnected) => {
      setSocketOk(isConnected);
      setChecking(false);
    });
  }, []);

  useEffect(() => {
    function applyMe() {
      api.me()
        .then((u) => {
          setMeId(u.id);
          setDesktopOn(Boolean(u.is_desktop_online));
        })
        .catch(() => setDesktopOn(false));
    }
    applyMe();
    const timer = setInterval(applyMe, 15_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    return subscribePresence((data) => {
      if (meId && data.userId === meId) {
        setDesktopOn(data.isOnline);
      }
    });
  }, [meId]);

  let label: string;
  let color: string;
  if (checking) {
    label = "Connecting…";
    color = "bg-amber-400";
  } else if (!socketOk) {
    label = "Reconnecting…";
    color = "bg-red-400";
  } else if (desktopOn) {
    label = "Ready";
    color = "bg-accent-400";
  } else {
    label = "Desktop off";
    color = "bg-amber-400";
  }

  const title = checking
    ? "Connecting to server…"
    : !socketOk
      ? "Web socket disconnected"
      : desktopOn
        ? "Connected — desktop app is running"
        : "Connected — open the desktop app to receive pings";

  return (
    <span
      className="status-pill max-w-[7.5rem] sm:max-w-none"
      title={title}
      role="status"
      aria-live="polite"
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${color}`} aria-hidden />
      <span className="truncate">
        <span className="sm:hidden">
          {checking ? "…" : !socketOk ? "Sync" : desktopOn ? "Ready" : "Off"}
        </span>
        <span className="hidden sm:inline">{label}</span>
      </span>
    </span>
  );
}

function DashboardHeaderChrome({ fullWidth = false }: { fullWidth?: boolean }) {
  const chrome = useDashboardChromeOptional()?.chrome;
  if (!chrome) return null;

  const tabs = [
    { id: "send" as const, label: "Send", tabId: "tab-send", panelId: "panel-send" },
    { id: "draw" as const, label: "Draw", tabId: "tab-draw", panelId: "panel-draw" },
    { id: "friends" as const, label: "Friends", tabId: "tab-friends", panelId: "panel-friends" },
  ];

  function focusTab(id: "send" | "friends" | "draw") {
    chrome.setTab(id);
    document.getElementById(
      id === "send" ? "tab-send" : id === "draw" ? "tab-draw" : "tab-friends",
    )?.focus();
  }

  function onTabKeyDown(e: KeyboardEvent<HTMLButtonElement>, current: "send" | "friends" | "draw") {
    const order: ("send" | "friends" | "draw")[] = ["send", "draw", "friends"];
    const index = order.indexOf(current);
    let next: "send" | "friends" | "draw" | null = null;

    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        next = order[(index + 1) % order.length];
        break;
      case "ArrowLeft":
      case "ArrowUp":
        next = order[(index - 1 + order.length) % order.length];
        break;
      case "Home":
        next = order[0];
        break;
      case "End":
        next = order[order.length - 1];
        break;
      default:
        return;
    }

    e.preventDefault();
    focusTab(next);
  }

  return (
    <>
      <span className="hidden h-6 w-px shrink-0 bg-slate-700/80 lg:block" aria-hidden />
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2 lg:gap-x-4">
        <div className="hidden min-w-0 sm:block">
          <p className="font-display text-sm font-extrabold leading-tight text-slate-100">Dashboard</p>
        </div>
        <div
          className={`pill-group shrink-0 ${fullWidth ? "w-full" : "w-full sm:w-fit"}`}
          role="tablist"
          aria-label="Dashboard sections"
        >
          {tabs.map((tab) => (
            <button
              key={tab.id}
              id={tab.tabId}
              type="button"
              role="tab"
              aria-selected={chrome.tab === tab.id}
              aria-controls={tab.panelId}
              tabIndex={chrome.tab === tab.id ? 0 : -1}
              onClick={() => chrome.setTab(tab.id)}
              onKeyDown={(e) => onTabKeyDown(e, tab.id)}
              className={`pill-btn ${chrome.tab === tab.id ? "pill-btn-active" : ""}`}
            >
              {tab.label}
              {tab.id === "friends" && chrome.friendsPending && (
                <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-amber-400" aria-label="Pending requests" />
              )}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

function DashboardHeaderActions() {
  const chrome = useDashboardChromeOptional()?.chrome;
  if (!chrome) return null;

  return (
    <button type="button" onClick={chrome.onLogout} className="btn-ghost inline-flex text-xs sm:text-sm">
      Log out
    </button>
  );
}

export default function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [authState, setAuthState] = useState<"loading" | "authed" | "guest">("loading");
  const [mustAcceptLegal, setMustAcceptLegal] = useState(false);

  useEffect(() => {
    void ensureAuthBootstrapped().then((ok) => {
      setAuthState(ok ? "authed" : "guest");
    });
  }, []);

  useEffect(() => {
    function onExpired() {
      navigate("/login", { replace: true });
    }
    window.addEventListener("auth:expired", onExpired);
    return () => window.removeEventListener("auth:expired", onExpired);
  }, [navigate]);

  useEffect(() => {
    if (authState !== "authed") return;
    api.me()
      .then((user) => {
        const needsAcceptance = Boolean(user.needs_terms_acceptance);
        setMustAcceptLegal(needsAcceptance);
        if (needsAcceptance && location.pathname !== "/legal/acceptance") {
          navigate("/legal/acceptance", { replace: true });
        }
      })
      .catch(() => {
        void logoutSession();
        setAuthState("guest");
        navigate("/login", { replace: true });
      });
  }, [authState, location.pathname, navigate]);

  if (authState === "loading") {
    return (
      <AppShellSkeleton label="Loading session">
        <DashboardSkeleton />
      </AppShellSkeleton>
    );
  }

  if (authState === "guest") return <Navigate to="/login" replace />;

  return (
    <DashboardChromeProvider>
      <div className="app-bg">
        <SkipLink />
        <header className="app-header">
          <div className="mx-auto flex w-full flex-col gap-2 px-3 py-2.5 sm:px-5 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between lg:gap-x-3 lg:gap-y-2 lg:px-8 xl:px-10">
            <div className="flex w-full min-w-0 items-center justify-between gap-3 lg:flex-1 lg:justify-start">
              <h1 className="brand-glow shrink-0 font-display text-lg font-extrabold tracking-tight">
                <Link
                  to="/"
                  className="flex cursor-pointer items-center gap-2 transition duration-200 hover:text-brand-300"
                >
                  <img
                    src="/logo.png"
                    alt=""
                    width={28}
                    height={28}
                    className="h-7 w-7 select-none"
                    draggable={false}
                  />
                  <span>Screen Ping</span>
                </Link>
              </h1>
              <div className="flex shrink-0 items-center gap-2 sm:gap-3 lg:hidden">
                <DashboardHeaderActions />
                <HeaderStatus />
                <ProfileAvatarButton />
              </div>
              <div className="hidden min-w-0 flex-1 items-center gap-3 lg:flex">
                <DashboardHeaderChrome />
              </div>
            </div>
            <div className="w-full lg:hidden">
              <DashboardHeaderChrome fullWidth />
            </div>
            <div className="hidden shrink-0 items-center gap-2 sm:gap-3 lg:flex">
              <DashboardHeaderActions />
              <HeaderStatus />
              <ProfileAvatarButton />
            </div>
          </div>
        </header>
        <main
          id="main-content"
          className={`flex min-h-0 w-full flex-1 flex-col px-3 py-3 sm:px-5 sm:py-4 lg:px-8 lg:py-3 xl:px-10 ${
            location.pathname === "/" ? "dashboard-main" : "overflow-y-auto"
          }`}
        >
          <Outlet />
        </main>
        <footer className="app-footer mx-auto flex w-full shrink-0 flex-col gap-2 px-3 pb-5 sm:px-5 lg:px-8 xl:px-10">
          {mustAcceptLegal && location.pathname !== "/legal/acceptance" && (
            <p className="text-center text-xs text-amber-300">You must accept the Terms to keep using the service.</p>
          )}
          <div className="footer-bar">
            <div className="footer-kofi">
              <SupportKofi />
            </div>
            <LegalLinks />
            <div className="footer-download">
              <DownloadDesktopPill />
            </div>
          </div>
        </footer>
      </div>
    </DashboardChromeProvider>
  );
}
