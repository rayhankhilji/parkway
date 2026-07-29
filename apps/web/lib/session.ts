/**
 * Where a seat lives on this device.
 *
 * A player's token is the only thing proving they are who they say they are, and
 * it exists in exactly two places: hashed on the server, and here. Keyed by game
 * id so one browser can hold seats in several games at once without them
 * overwriting each other.
 *
 * Losing local storage means losing the seat. That is the accepted cost of not
 * asking anyone to make an account (→ D9), and it is why nothing else in the app
 * treats the token as recoverable.
 */

const prefix = 'parkway';

export type Session = {
  readonly gameId: string;
  readonly playerId: string;
  readonly token: string;
};

function key(gameId: string): string {
  return `${prefix}:${gameId}`;
}

export function saveSession(session: Session): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(
    key(session.gameId),
    JSON.stringify({ playerId: session.playerId, token: session.token }),
  );
}

export function loadSession(gameId: string): Session | null {
  if (typeof window === 'undefined') return null;

  const raw = window.localStorage.getItem(key(gameId));
  if (raw === null) return null;

  // Storage is shared with anything else on this origin and survives across
  // deploys, so what comes back is checked rather than trusted.
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { playerId, token } = parsed as Record<string, unknown>;
    if (typeof playerId !== 'string' || typeof token !== 'string') return null;
    return { gameId, playerId, token };
  } catch {
    return null;
  }
}

export function clearSession(gameId: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(key(gameId));
}
