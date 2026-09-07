export default function LoadingDots({ label = "Loading" }: { label?: string }) {
  return (
    <p className="loading-dots" role="status" aria-live="polite">
      <span aria-hidden>
        <span />
        <span />
        <span />
      </span>
      {label}
    </p>
  );
}
