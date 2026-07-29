import 'server-only';
import type { GameEvent, PublicGameState } from '@parkway/engine';
import { db } from './db';

/**
 * Server to client fan-out.
 *
 * Broadcast rather than postgres_changes, and the reason is the whole design in
 * one line: postgres_changes would ship the raw row, and the raw row contains
 * the generator seed and both deck orders. Broadcasting a projection is the only
 * way to use Realtime at all without publishing the game's secrets.
 *
 * The channel name is the game's UUID, which is unguessable and therefore acts
 * as the read capability. The six-character room code is only ever exchanged for
 * it through the join endpoint.
 *
 * Delivery is best effort. The actor already has the authoritative result in
 * their own POST response; this is for everyone else, and a client that misses a
 * message notices the sequence gap and refetches.
 */

export type StatePayload = {
  readonly seq: number;
  readonly publicState: PublicGameState;
  readonly events: readonly GameEvent[];
};

export async function broadcastState(gameId: string, payload: StatePayload): Promise<void> {
  const channel = db().channel(`game:${gameId}`, { config: { broadcast: { ack: true } } });

  try {
    await channel.subscribe();
    await channel.send({ type: 'broadcast', event: 'state', payload });
  } catch (error) {
    // A failed broadcast must not fail the action that has already committed.
    // The state is durable; clients will resync on their next gap or refetch.
    console.error(`Broadcast to game:${gameId} failed`, error);
  } finally {
    await db().removeChannel(channel);
  }
}
