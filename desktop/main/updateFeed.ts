/**
 * Resolve the next stepwise update feed before electron-updater checks.
 * Clients climb one version at a time (e.g. 1.0.58 → 1.0.59 → 1.0.60).
 */
import { app } from "electron";
import { autoUpdater } from "electron-updater";

import { normalizeServerUrl } from "./serverUrl";
import store from "./store";

export type NextUpdateInfo = {
  from: string;
  next: string | null;
  latest: string;
  feed_url?: string;
  download_url?: string;
  version?: string;
};

export async function fetchNextUpdate(fromVersion?: string): Promise<NextUpdateInfo | null> {
  const serverUrl = normalizeServerUrl(store.get("serverUrl"));
  const from = fromVersion || app.getVersion();
  try {
    const res = await fetch(`${serverUrl}/api/desktop/next?from=${encodeURIComponent(from)}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as NextUpdateInfo;
  } catch {
    return null;
  }
}

/** Point electron-updater at the next version feed. Returns false if already current. */
export async function applySteppedUpdateFeed(): Promise<{
  upToDate: boolean;
  next: string | null;
  latest: string | null;
  downloadUrl: string | null;
}> {
  const info = await fetchNextUpdate();
  if (!info || !info.next || !info.feed_url) {
    return {
      upToDate: true,
      next: null,
      latest: info?.latest ?? null,
      downloadUrl: info?.download_url ?? null,
    };
  }

  const feedUrl = info.feed_url.endsWith("/") ? info.feed_url : `${info.feed_url}/`;
  autoUpdater.setFeedURL({
    provider: "generic",
    url: feedUrl,
  });

  return {
    upToDate: false,
    next: info.next,
    latest: info.latest,
    downloadUrl: info.download_url ?? null,
  };
}
