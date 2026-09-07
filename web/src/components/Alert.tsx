import type { ReactNode } from "react";

type AlertVariant = "info" | "warning" | "success" | "error";

interface AlertProps {
  variant?: AlertVariant;
  title?: string;
  children: ReactNode;
  className?: string;
}

export default function Alert({ variant = "info", title, children, className = "" }: AlertProps) {
  return (
    <div
      role={variant === "error" ? "alert" : "status"}
      className={`alert alert-${variant} ${className}`}
    >
      {title && <p className="mb-0.5 font-medium">{title}</p>}
      <div className="text-[13px] leading-relaxed opacity-95">{children}</div>
    </div>
  );
}
