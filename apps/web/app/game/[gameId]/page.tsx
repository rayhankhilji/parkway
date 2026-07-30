import { GameScreen } from '@/components/GameScreen';

/**
 * The game route.
 *
 * A server component that renders nothing but the client shell. The game state is
 * fetched with the player's token, which lives in the browser and never reaches a
 * server render — so there is nothing to fetch here and nothing to leak.
 */
export default async function GamePage({ params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  return <GameScreen gameId={gameId} />;
}
