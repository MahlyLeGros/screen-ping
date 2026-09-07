import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

export type DashboardTab = "send" | "friends" | "draw";

export interface DashboardChromeState {
  tab: DashboardTab;
  setTab: (tab: DashboardTab) => void;
  friendsPending: boolean;
  onLogout: () => void;
}

interface DashboardChromeContextValue {
  chrome: DashboardChromeState | null;
  setChrome: (chrome: DashboardChromeState | null) => void;
}

const DashboardChromeContext = createContext<DashboardChromeContextValue | null>(null);

export function DashboardChromeProvider({ children }: { children: ReactNode }) {
  const [chrome, setChrome] = useState<DashboardChromeState | null>(null);
  const value = useMemo(() => ({ chrome, setChrome }), [chrome]);
  return <DashboardChromeContext.Provider value={value}>{children}</DashboardChromeContext.Provider>;
}

export function useDashboardChrome() {
  const ctx = useContext(DashboardChromeContext);
  if (!ctx) {
    throw new Error("useDashboardChrome must be used within DashboardChromeProvider");
  }
  return ctx;
}

export function useDashboardChromeOptional() {
  return useContext(DashboardChromeContext);
}
