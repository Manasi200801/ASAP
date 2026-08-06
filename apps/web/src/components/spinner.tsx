export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block h-3 w-3 flex-none animate-spin rounded-full border-2 border-on-surface-faint/30 border-t-on-surface-faint ${className}`}
    />
  );
}
