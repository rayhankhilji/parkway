/**
 * Below 768px the app asks for a bigger screen rather than pretending.
 *
 * A forty-square board with readable prices, plus a feed and a player panel, does
 * not fit a phone without becoming a different product with a different
 * information architecture. A deliberate, honest block beats a cramped layout
 * that technically renders (→ D13).
 */
export function SmallScreenNotice() {
  return (
    <div className="flex min-h-screen items-center justify-center p-6 md:hidden">
      <div className="max-w-xs text-center">
        <h1 className="text-lg font-semibold">Parkway needs a larger screen</h1>
        <p className="mt-3 text-base text-text-muted">
          The board does not fit a phone without becoming unreadable. Open this on a tablet or a
          desktop and your seat will be waiting.
        </p>
      </div>
    </div>
  );
}
