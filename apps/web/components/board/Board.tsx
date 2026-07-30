'use client';

import { getBoardPack, getSquare } from '@parkway/engine';
import type { PublicGameState } from '@parkway/engine';
import type { PlayerSummary } from '@/lib/apiClient';
import { boardGrid } from './layout';
import { Square } from './Square';
import { CentrePanel } from './CentrePanel';

/**
 * The board.
 *
 * Positions come from state and nothing else — there is no local model of where
 * anyone is. The component reads the same board pack the engine read, so the
 * squares on screen and the squares the rules operate on cannot disagree.
 */
export function Board({
  state,
  players,
  currency,
}: {
  readonly state: PublicGameState;
  readonly players: readonly PlayerSummary[];
  readonly currency: string;
}) {
  const pack = getBoardPack(state.boardPackId);
  const { placements, template } = boardGrid(pack);

  const colourOf = (playerId: string): string =>
    players.find((player) => player.id === playerId)?.colour ?? 'slate';

  const activeId = state.turnOrder[state.activeIndex];

  return (
    <div
      className="grid aspect-square w-full max-w-[820px] gap-1 rounded-lg border border-border bg-bg p-1"
      style={{ gridTemplateColumns: template, gridTemplateRows: template }}
    >
      {placements.map((placement) => {
        const square = getSquare(pack, placement.id);
        const deed = state.deeds[placement.id];
        const owner = deed?.ownerId ?? null;

        return (
          <Square
            key={placement.id}
            square={square}
            placement={placement}
            deed={deed}
            currency={currency}
            ownerColour={owner === null ? null : colourOf(owner)}
            isActive={activeId !== undefined && state.players[activeId]?.position === placement.id}
            occupants={state.turnOrder
              .filter((id) => {
                const player = state.players[id];
                return player !== undefined && !player.bankrupt && player.position === placement.id;
              })
              .map((id) => ({ playerId: id, colour: colourOf(id) }))}
          />
        );
      })}

      <CentrePanel state={state} players={players} currency={currency} tracks={template} />
    </div>
  );
}
