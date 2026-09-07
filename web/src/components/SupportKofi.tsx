import { KOFI_LABEL, KOFI_URL } from "../content/support";

interface SupportKofiProps {
  /** Compact text link for footers; pill is the default CTA. */
  variant?: "pill" | "link";
  className?: string;
}

function CoffeeIcon({ className = "" }: { className?: string }) {
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
      <path d="M18 8h1a4 4 0 0 1 0 8h-1" />
      <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z" />
      <line x1="6" y1="1" x2="6" y2="4" />
      <line x1="10" y1="1" x2="10" y2="4" />
      <line x1="14" y1="1" x2="14" y2="4" />
    </svg>
  );
}

/** Optional tip CTA — opens Ko-fi without cluttering the main send flow. */
export default function SupportKofi({ variant = "pill", className = "" }: SupportKofiProps) {
  if (variant === "link") {
    return (
      <a
        href={KOFI_URL}
        target="_blank"
        rel="noopener noreferrer"
        className={`inline-flex items-center gap-1.5 text-xs text-irid-violet transition duration-200 hover:text-irid-pink hover:underline ${className}`}
      >
        <CoffeeIcon />
        {KOFI_LABEL}
      </a>
    );
  }

  return (
    <a
      href={KOFI_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={`kofi-pill ${className}`}
      title="Buy me a coffee — optional tip"
    >
      <CoffeeIcon className="kofi-pill__icon" />
      <span>{KOFI_LABEL}</span>
    </a>
  );
}
