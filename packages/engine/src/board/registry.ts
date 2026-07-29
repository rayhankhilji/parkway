import type { BoardPack } from './types.js';
import { parkwayClassic } from './packs/parkwayClassic.js';

const packs: ReadonlyMap<string, BoardPack> = new Map([[parkwayClassic.id, parkwayClassic]]);

export const defaultBoardPackId = parkwayClassic.id;

/**
 * Resolves a board pack id to its pack.
 *
 * Throws rather than returning a Result. A game state naming a pack that does not
 * exist is not a player doing something the rules forbid — it is a corrupt
 * document or a deleted pack, and there is no sensible way for a caller to carry
 * on. Rule violations are returned; broken invariants are thrown (→ D15).
 */
export function getBoardPack(id: string): BoardPack {
  const pack = packs.get(id);
  if (pack === undefined) {
    throw new Error(`Unknown board pack: ${id}`);
  }
  return pack;
}

export function listBoardPackIds(): readonly string[] {
  return [...packs.keys()];
}
