import 'server-only';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { db, failed } from './db';

/**
 * Authorisation, in a product with no accounts.
 *
 * "No accounts" is a requirement about friction, not a decision to skip
 * authorisation. Without a per-player secret, anyone holding a six-character
 * room code could act as any player — and a room code is by definition shared
 * (→ D9).
 *
 * So each player gets 32 random bytes at join. The plaintext is returned exactly
 * once and only its SHA-256 is stored, which means a database leak reveals no
 * usable credential. Losing the token means losing the seat; that is the
 * accepted cost of not asking anyone to make an account.
 */

export type PlayerRecord = {
  readonly id: string;
  readonly gameId: string;
  readonly name: string;
  readonly seat: number;
  readonly colour: string;
};

export function issueToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Constant-time comparison, so a hash cannot be recovered by timing guesses. */
export function tokensMatch(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Reads the bearer token from a request, or null when there is not one. */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (header === null) return null;
  const [scheme, value] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || value === undefined || value === '') return null;
  return value;
}

export type Authorisation =
  | { readonly kind: 'ok'; readonly player: PlayerRecord }
  | { readonly kind: 'missing' }
  | { readonly kind: 'wrong_game' };

/**
 * Resolves a token to the player it belongs to, scoped to one game.
 *
 * A token that is valid but for a different game is a distinct answer from a
 * token that is not valid at all: the first is a 403, the second a 401. Merging
 * them would tell someone probing with a stolen token less than they deserve to
 * know, and tell a player with a genuine mix-up nothing useful.
 */
export async function authorise(request: Request, gameId: string): Promise<Authorisation> {
  const token = bearerToken(request);
  if (token === null) return { kind: 'missing' };

  const hash = hashToken(token);
  const { data, error } = await db()
    .from('players')
    .select('id, game_id, name, seat, colour')
    .eq('token_hash', hash)
    .limit(1);

  if (error !== null) failed('Resolving a player token', error);

  const row = data?.[0];
  if (row === undefined) return { kind: 'missing' };
  if (row.game_id !== gameId) return { kind: 'wrong_game' };

  return {
    kind: 'ok',
    player: {
      id: row.id as string,
      gameId: row.game_id as string,
      name: row.name as string,
      seat: row.seat as number,
      colour: row.colour as string,
    },
  };
}

/** Finds the player a token belongs to without knowing which game to expect. */
export async function playerForToken(token: string): Promise<PlayerRecord | null> {
  const { data, error } = await db()
    .from('players')
    .select('id, game_id, name, seat, colour')
    .eq('token_hash', hashToken(token))
    .limit(1);

  if (error !== null) failed('Resolving a player token', error);

  const row = data?.[0];
  if (row === undefined) return null;

  return {
    id: row.id as string,
    gameId: row.game_id as string,
    name: row.name as string,
    seat: row.seat as number,
    colour: row.colour as string,
  };
}
