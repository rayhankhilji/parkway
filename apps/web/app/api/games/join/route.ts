import { NextResponse } from 'next/server';
import { z } from 'zod';
import { bearerToken, playerForToken } from '@/server/auth';
import { findGameByCode, joinGame, loadGame } from '@/server/gameService';
import { fail, handle } from '@/server/http';
import { isRoomCode, normaliseRoomCode } from '@/lib/roomCode';

export const runtime = 'nodejs';

const joinBody = z
  .object({
    roomCode: z.string().trim().min(1),
    name: z.string().trim().min(1).max(20),
  })
  .strict();

/**
 * Each way a join can fail gets its own answer.
 *
 * "Could not join" is a failed implementation of this contract. A player who
 * mistyped a code, a player who arrived after the game started, and a player
 * whose friend already took their name all need to do different things next, and
 * a shared message tells none of them which.
 */
const refusals = {
  GAME_NOT_FOUND: [404, 'No game has that code. Check it and try again.'],
  GAME_ALREADY_STARTED: [409, 'That game has already started, so no one else can join.'],
  GAME_FULL: [409, 'That game already has six players.'],
  NAME_TAKEN: [409, 'Someone in that game is already using that name. Pick another.'],
  GAME_FINISHED: [410, 'That game has finished.'],
} as const;

export async function POST(request: Request): Promise<Response> {
  return handle('Joining a game', async () => {
    const body: unknown = await request.json().catch(() => null);
    const parsed = joinBody.safeParse(body);

    if (!parsed.success) {
      return fail(400, 'INVALID_REQUEST', 'Enter a room code and a name of 1 to 20 characters.');
    }

    const roomCode = normaliseRoomCode(parsed.data.roomCode);
    if (!isRoomCode(roomCode)) {
      return fail(400, 'INVALID_CODE', 'A room code is six characters, letters and numbers.');
    }

    // Someone returning with a token that already holds a seat in this game is
    // reconnecting, not joining. That is how a refresh mid-game gets you back to
    // your own seat rather than a second one (→ D9).
    const token = bearerToken(request);
    if (token !== null) {
      const gameId = await findGameByCode(roomCode);
      const player = await playerForToken(token);
      if (gameId !== null && player !== null && player.gameId === gameId) {
        const game = await loadGame(gameId, player.id);
        if (game !== null) {
          return NextResponse.json({
            gameId,
            roomCode,
            playerId: player.id,
            game,
          });
        }
      }
    }

    const outcome = await joinGame(roomCode, parsed.data.name);

    if (outcome.kind === 'refused') {
      const [status, message] = refusals[outcome.reason];
      return fail(status, outcome.reason, message);
    }

    if (outcome.kind !== 'joined') {
      return fail(409, 'GAME_ALREADY_STARTED', 'That game has already started.');
    }

    const game = await loadGame(outcome.gameId, outcome.playerId);
    if (game === null) {
      return fail(404, 'GAME_NOT_FOUND', 'That game no longer exists.');
    }

    return NextResponse.json({
      gameId: outcome.gameId,
      roomCode,
      playerId: outcome.playerId,
      playerToken: outcome.playerToken,
      game,
    });
  });
}
