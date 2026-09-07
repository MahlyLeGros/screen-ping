import type { ReactNode } from "react";
import { createPortal } from "react-dom";

interface DesktopStatusToastProps {
  title: string;
  children: ReactNode;
  onDismiss: () => void;
}

export default function DesktopStatusToast({ title, children, onDismiss }: DesktopStatusToastProps) {
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[80] flex justify-end p-3 pt-[4.5rem] sm:p-4 sm:pt-[4.25rem]">
      <aside
        role="status"
        aria-live="polite"
        className="pointer-events-auto relative w-full max-w-sm rounded-xl bg-[#161410] px-3.5 py-3 text-sm text-amber-100 shadow-[0_8px_32px_rgba(0,0,0,0.65),inset_0_0_0_1px_rgba(251,191,36,0.4)]"
      >
        <button
          type="button"
          onClick={onDismiss}
          className="absolute right-2 top-2 flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-amber-100/80 transition hover:bg-white/10 hover:text-white"
          aria-label="Dismiss"
        >
          <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" aria-hidden>
            <path d="M2 2l8 8M10 2L2 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
        <p className="mb-0.5 pr-7 font-medium">{title}</p>
        <div className="pr-7 text-[13px] leading-relaxed opacity-95">{children}</div>
      </aside>
    </div>,
    document.body,
  );
}
