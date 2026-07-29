/**
 * The room code alphabet, shared by both sides.
 *
 * O, 0, I and 1 are left out, because a code's whole job is to be read aloud
 * over a call or copied off someone's screen, and those are the pairs people get
 * wrong (→ PRD F1). The database check constraint enforces the same set, so a
 * code that could be mistyped into another game cannot be stored even by a
 * different code path.
 *
 * This module is deliberately free of Node built-ins so the join form can reject
 * a malformed code before sending it, rather than making someone wait for a round
 * trip to be told they typed an O instead of a zero. Generating codes needs real
 * entropy and stays on the server.
 */

export const roomCodeAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const roomCodeLength = 6;

export function isRoomCode(value: string): boolean {
  if (value.length !== roomCodeLength) return false;
  return [...value].every((character) => roomCodeAlphabet.includes(character));
}

/** Codes are stored uppercase; input is accepted in any case. */
export function normaliseRoomCode(value: string): string {
  return value.trim().toUpperCase();
}
