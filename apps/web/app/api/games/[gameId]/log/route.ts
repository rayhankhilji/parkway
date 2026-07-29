import { NextResponse } from 'next/server';
import { authorise } from '@/server/auth';
import { gameExists, loadLog } from '@/server/gameService';
import { fail, forbidden, handle, notFound, unauthorised } from '@/server/http';

export const runtime = 'nodejs';

/**
 * The events a client is missing.
 *
 * Fetched after a reconnect so the feed is complete rather than starting from
 * whenever the player came back. State alone would leave a game that reads as if
 * nothing happened while they were away.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ gameId: string }> },
): Promise<Response> {
  return handle('Loading the action log', async () => {
    const { gameId } = await params;
    const auth = await authorise(request, gameId);

    if (auth.kind === 'missing') return unauthorised();
    if (auth.kind === 'wrong_game') return forbidden();

    const raw = new URL(request.url).searchParams.get('since') ?? '0';
    const since = Number(raw);
    if (!Number.isInteger(since) || since < 0) {
      return fail(
        400,
        'INVALID_SINCE',
        'The `since` parameter must be a whole number, zero or more.',
      );
    }

    const log = await loadLog(gameId, since);

    // Distinguish "no actions yet" from "no such game", so a bad id does not
    // silently read as a quiet lobby.
    if (log.entries.length === 0 && !(await gameExists(gameId))) {
      return notFound();
    }

    return NextResponse.json(log);
  });
}
