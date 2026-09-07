import type { ReactNode } from "react";
import { createPortal } from "react-dom";

import { useFocusTrap } from "../hooks/useFocusTrap";

interface AccessibleDialogProps {
  open: boolean;
  labelledBy: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  panelClassName?: string;
}

export default function AccessibleDialog({
  open,
  labelledBy,
  onClose,
  children,
  className = "fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm",
  panelClassName = "panel my-auto w-full max-w-sm space-y-4 p-4",
}: AccessibleDialogProps) {
  const trapRef = useFocusTrap(open, onClose);

  if (!open) return null;

  return createPortal(
    <div
      className={className}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className={panelClassName}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
