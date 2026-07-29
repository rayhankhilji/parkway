import { parseGameConfig } from '@parkway/engine';
import { z } from 'zod';
import { createGameRecord } from '@/server/gameService';
import { fail, handle } from '@/server/http';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

/**
 * Two validators, deliberately.
 *
 * zod checks the request envelope — that a body arrived, that `name` is a string
 * of a sensible length. The engine's own parseGameConfig checks the rule
 * configuration, because which starting cash amounts are permitted is a game
 * rule, and a second copy of that list in a request schema would drift from the
 * engine that has to honour it (→ D14).
 */
const createBody = z
  .object({
    name: z.string().trim().min(1).max(20),
    config: z.unknown().optional(),
  })
  .strict();

export async function POST(request: Request): Promise<Response> {
  return handle('Creating a game', async () => {
    const body: unknown = await request.json().catch(() => null);
    const parsed = createBody.safeParse(body);

    if (!parsed.success) {
      return fail(400, 'INVALID_NAME', 'Enter a name between 1 and 20 characters.');
    }

    const config = parseGameConfig(parsed.data.config);
    if (!config.ok) {
      return fail(400, 'INVALID_CONFIG', config.error.message);
    }

    const created = await createGameRecord(parsed.data.name, config.value);

    return NextResponse.json(
      {
        gameId: created.gameId,
        roomCode: created.roomCode,
        playerId: created.playerId,
        // Returned exactly once. It is never retrievable again, because only its
        // hash is stored.
        playerToken: created.playerToken,
        game: created.game,
      },
      { status: 201 },
    );
  });
}
