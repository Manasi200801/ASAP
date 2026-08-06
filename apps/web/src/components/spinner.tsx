/**
 * Colour and size come from the caller's context, not from a fixed token, so
 * the same spinner reads correctly on a muted table row and inside a coloured
 * status pill. Geometry and speed live in `.spinner` in globals.css, which is
 * also where reduced-motion slows it rather than freezing it.
 */
export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span aria-hidden="true" className={`spinner inline-block h-4 w-4 flex-none ${className}`} />
  );
}
