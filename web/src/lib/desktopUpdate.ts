export const DESKTOP_UPDATE_PROTOCOL = "screenping://update";
export const DESKTOP_EVER_KEY = "sp-desktop-ever";

/** Set when we detect the desktop app connected at least once. */
export function markDesktopEverConnected(): void {
  try {
    localStorage.setItem(DESKTOP_EVER_KEY, "1");
  } catch {
    /* ignore */
  }
}

export function hasEverConnectedDesktop(): boolean {
  try {
    return localStorage.getItem(DESKTOP_EVER_KEY) === "1";
  } catch {
    return false;
  }
}

/** Download the Windows installer (.exe) — first install or manual fallback. */
export function openDesktopInstaller(installerUrl: string): void {
  const link = document.createElement("a");
  link.href = installerUrl;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/**
 * Open Screen Ping and trigger the same update check as tray → "Check for updates".
 * Requires the desktop app to be installed (screenping:// protocol).
 */
export function openDesktopUpdateApp(): void {
  const link = document.createElement("a");
  link.href = DESKTOP_UPDATE_PROTOCOL;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
}
