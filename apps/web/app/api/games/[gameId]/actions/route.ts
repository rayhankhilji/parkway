import { NextResponse } from 'next/server';
import { parseAction } from '@parkway/engine';
import { z } from 'zod';
import { authorise } from '@/server/auth';
import { applyAction } from '@/server/gameService';
import { fail, forbidden, handle, notFound, unauthorised } from '@/server/http';

export const runtime = 'nodejs';

/**
 * The single mutating endpoint. Every game action goes through here — starting
 * the game, ending a turn, and auction timeouts included.
 *
 * The two failure modes below are deliberately different statuses. A body that
 * fails parseAction is a broken client and answers 400; a well-formed action the
 * rules forbid is a player trying something and answers 422 with the engine's
 * code intact, so the UI can explain the refusal next to the control that caused
 * it (→ D15).
 */
const envelope = z
  .object({
    expectedSeq: z.number().int().nonnegative(),
    action: z.unknown(),
  })
  .strict();

export async function POST(
  request: Request,
  { params }: { params: Promise<{ gameId: string }> },
): Promise<Response> {
  return handle('Applying an action', async () => {
    const { gameId } = await params;
    const auth = await authorise(request, gameId);

    if (auth.kind === 'missing') return unauthorised();
    if (auth.kind === 'wrong_game') return forbidden();

    const body: unknown = await request.json().catch(() => null);
    const parsedEnvelope = envelope.safeParse(body);
    if (!parsedEnvelope.success) {
      return fail(400, 'MALFORMED_ACTION', 'That request was not in the expected shape.');
    }

    const action = parseAction(parsedEnvelope.data.action);
    if (!action.ok) {
      return fail(400, 'MALFORMED_ACTION', action.error.message, { path: action.error.path });
    }

    const outcome = await applyAction(
      gameId,
      auth.player.id,
      parsedEnvelope.data.expectedSeq,
      action.value,
      // The server's own clock, stamped here. A client's time is never trusted,
      // which is what makes an auction timeout unspoofable (→ D5).
      Date.now(),
    );

    switch (outcome.kind) {
      case 'not_found':
        return notFound();

      case 'conflict':
        // The client refetches and lets the player decide again. It must not
        // resend the action — reapplying it against a state that has moved on is
        // exactly the bug this guard exists to prevent (→ D4).
        return fail(409, 'SEQ_CONFLICT', 'Someone moved first. Catching up.', {
          seq: outcome.seq,
        });

      case 'violation':
        return fail(422, outcome.violation.code, outcome.violation.message);

      case 'applied':
        return NextResponse.json({
          seq: outcome.seq,
          events: outcome.events,
          game: outcome.game,
        });
    }
  });
}
