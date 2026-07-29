import { NextResponse } from 'next/server';
import { authorise } from '@/server/auth';
import { loadGame } from '@/server/gameService';
import { forbidden, handle, notFound, unauthorised } from '@/server/http';

export const runtime = 'nodejs';

/**
 * Full authoritative state, used on load, on reconnect, and after any sequence
 * gap. Reading requires a token too, so a leaked room code alone cannot be used
 * to watch a game in progress.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ gameId: string }> },
): Promise<Response> {
  return handle('Loading a game', async () => {
    const { gameId } = await params;
    const auth = await authorise(request, gameId);

    if (auth.kind === 'missing') return unauthorised();
    if (auth.kind === 'wrong_game') return forbidden();

    const game = await loadGame(gameId, auth.player.id);
    if (game === null) return notFound();

    return NextResponse.json(game);
  });
}
