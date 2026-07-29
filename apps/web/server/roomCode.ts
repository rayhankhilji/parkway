import 'server-only';
import { randomInt } from 'node:crypto';
import { roomCodeAlphabet, roomCodeLength } from '@/lib/roomCode';

/**
 * Minting a room code.
 *
 * The alphabet and the format check are shared with the client (→ lib/roomCode);
 * only generation lives here, because it needs real entropy.
 *
 * Thirty-two characters over six positions is a little over a billion codes.
 * Collisions are rare but not impossible, so creation retries — and then gives up
 * loudly rather than ever handing back a code that belongs to another game.
 */

export const maxCodeAttempts = 6;

export function generateRoomCode(): string {
  let code = '';
  for (let index = 0; index < roomCodeLength; index += 1) {
    code += roomCodeAlphabet[randomInt(roomCodeAlphabet.length)];
  }
  return code;
}
