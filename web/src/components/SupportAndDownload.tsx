import { useEffect, useState } from "react";
import { fetchDesktopLatest } from "../lib/api";
import { openDesktopInstaller } from "../lib/desktopUpdate";

const FALLBACK_DOWNLOAD = "https://screenping.xyz/api/desktop/download";

function DownloadIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 3v12" />
      <path d="m7 11 5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  );
}

export function DownloadDesktopPill() {
  const [url, setUrl] = useState(FALLBACK_DOWNLOAD);

  useEffect(() => {
    void fetchDesktopLatest()
      .then((latest) => setUrl(latest.download_url))
      .catch(() => {});
  }, []);

  return (
    <button
      type="button"
      className="kofi-pill"
      title="Download Screen Ping for Windows"
      onClick={() => openDesktopInstaller(url)}
    >
      <DownloadIcon className="kofi-pill__icon" />
      <span>Download</span>
    </button>
  );
}
