type DeliveryStatus = "delivered" | "offline" | "paused" | "failed" | "pending" | string;

const labels: Record<string, string> = {
  delivered: "Delivered",
  offline: "Offline",
  paused: "Paused",
  failed: "Failed",
  pending: "Pending",
};

const hints: Record<string, string> = {
  delivered: "Shown on the receiver's screen",
  offline: "Friend did not have the desktop app open",
  paused: "Receiver paused incoming pings",
  failed: "Could not deliver this ping (cancelled, timed out, or error)",
  pending: "Waiting for delivery — cancel anytime, or auto-fails after 1 min",
};

const pillClass: Record<string, string> = {
  delivered: "status-pill status-pill-delivered",
  offline: "status-pill status-pill-pending",
  paused: "status-pill status-pill-paused",
  failed: "status-pill status-pill-failed",
  pending: "status-pill status-pill-pending",
};

interface StatusBadgeProps {
  status: DeliveryStatus;
}

export function deliveryLabel(status: string): string {
  return labels[status] ?? status;
}

export function deliveryHint(status: string): string {
  return hints[status] ?? status;
}

export default function StatusBadge({ status }: StatusBadgeProps) {
  const label = deliveryLabel(status);
  const hint = deliveryHint(status);
  const style = pillClass[status] ?? pillClass.pending;

  return (
    <span title={hint} aria-label={`${label}. ${hint}`} className={`shrink-0 font-medium ${style}`}>
      {label}
    </span>
  );
}
