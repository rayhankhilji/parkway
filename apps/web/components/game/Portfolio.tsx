'use client';

import {
  getBoardPack,
  getSquare,
  unmortgageCost,
  type Action,
  type LegalAction,
  type SquareId,
} from '@parkway/engine';
import { HouseIcon } from '@/components/board/icons';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import type { GamePayload } from '@/lib/apiClient';
import { cn } from '@/lib/cn';
import { formatMoney } from '@/lib/format';
import { rulesView } from '@/lib/rulesView';
import { Money } from './Money';

/**
 * Your property, set by set, with every move you can make on each lot.
 *
 * Which lots can be built on, sold from, mortgaged or redeemed is exactly the
 * `squareIds` list the engine attached to each legal action. Even-build, the
 * bank's supply, mortgaged neighbours — all of that has already been decided,
 * and this screen only lays the answer out.
 */
export function Portfolio({
  open,
  onClose,
  game,
  busy,
  onAct,
  onInspect,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly game: GamePayload;
  readonly busy: boolean;
  readonly onAct: (action: Action) => void;
  readonly onInspect: (squareId: SquareId) => void;
}) {
  const state = game.publicState;
  if (state === null) return null;

  const pack = getBoardPack(state.boardPackId);
  const money = (amount: number) => formatMoney(amount, pack.currencySymbol);
  const you = game.you.playerId;
  const cash = state.players[you]?.cash ?? 0;
  const view = rulesView(state);

  const ids = (type: LegalAction['type']): ReadonlySet<SquareId> => {
    const entry = game.legalActions.find((action) => action.type === type);
    return new Set(entry !== undefined && 'squareIds' in entry ? entry.squareIds : []);
  };
  const buildable = ids('BUILD_HOUSE');
  const sellable = ids('SELL_HOUSE');
  const mortgageable = ids('MORTGAGE');
  const redeemable = ids('UNMORTGAGE');

  const owned = pack.squares.filter((square) => state.deeds[square.id]?.ownerId === you);

  // Grouped as on the board: colour sets in order, then stations, then utilities.
  const sets = [
    ...pack.groups.map((group) => ({
      key: group.id,
      name: group.name,
      colour: `var(--color-${group.colourToken})`,
      members: owned.filter((square) => square.kind === 'property' && square.group === group.id),
      total: group.memberIds.length,
    })),
    {
      key: 'transit',
      name: 'Stations',
      colour: 'var(--color-group-rail)',
      members: owned.filter((square) => square.kind === 'transit'),
      total: pack.squares.filter((square) => square.kind === 'transit').length,
    },
    {
      key: 'utility',
      name: 'Utilities',
      colour: 'var(--color-group-utility)',
      members: owned.filter((square) => square.kind === 'utility'),
      total: pack.squares.filter((square) => square.kind === 'utility').length,
    },
  ].filter((set) => set.members.length > 0);

  const debt =
    state.phase.kind === 'awaiting_debt' && state.phase.debtorId === you
      ? state.phase.amount
      : null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Your property"
      subtitle={
        <span className="flex items-center gap-2">
          Cash in hand{' '}
          <Money
            amount={cash}
            currency={pack.currencySymbol}
            className="font-semibold text-gold-bright"
          />
          {debt !== null && <span className="text-[#ffb4aa]">· you owe {money(debt)}</span>}
        </span>
      }
      className="sm:max-w-2xl"
      footer={
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      {sets.length === 0 ? (
        <p className="py-10 text-center text-text-muted">
          You don&apos;t own anything yet. Land on a lot and buy it.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {sets.map((set) => (
            <section
              key={set.key}
              className="overflow-hidden rounded-2xl bg-black/25 ring-1 ring-inset ring-white/5"
            >
              <header className="flex items-center gap-2 px-4 py-2.5">
                <span className="h-3 w-6 rounded-sm" style={{ background: set.colour }} />
                <h3 className="flex-1 text-sm font-semibold">{set.name}</h3>
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 text-xs font-semibold',
                    set.members.length === set.total
                      ? 'bg-gold/15 text-gold-bright'
                      : 'text-text-faint',
                  )}
                >
                  {set.members.length === set.total
                    ? 'Full set'
                    : `${set.members.length} of ${set.total}`}
                </span>
              </header>
              <ul className="divide-y divide-white/5">
                {set.members.map((square) => {
                  const deed = state.deeds[square.id];
                  const full = getSquare(pack, square.id);
                  const buildCost = full.kind === 'property' ? full.buildCost : 0;
                  const mortgageValue = 'mortgageValue' in full ? full.mortgageValue : 0;
                  return (
                    <li key={square.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
                      <button
                        type="button"
                        onClick={() => onInspect(square.id)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <span
                          className={cn(
                            'block truncate text-sm font-medium hover:underline',
                            deed?.mortgaged === true && 'text-text-faint line-through',
                          )}
                        >
                          {square.name}
                        </span>
                        <span className="flex h-4 items-center gap-0.5 text-xs text-text-faint">
                          {deed?.mortgaged === true ? (
                            'Mortgaged'
                          ) : deed !== undefined && deed.hotels > 0 ? (
                            <span className="rounded-sm bg-[#c8262c] px-1 text-[10px] font-bold text-white">
                              HOTEL
                            </span>
                          ) : deed !== undefined && deed.houses > 0 ? (
                            Array.from({ length: deed.houses }, (_, index) => (
                              <HouseIcon key={index} className="size-3 text-good" />
                            ))
                          ) : (
                            'No buildings'
                          )}
                        </span>
                      </button>
                      <div className="flex flex-wrap gap-1.5">
                        {buildable.has(square.id) && (
                          <Button
                            size="sm"
                            variant="good"
                            disabled={busy}
                            onClick={() => onAct({ type: 'BUILD_HOUSE', squareId: square.id })}
                          >
                            Build · {money(buildCost)}
                          </Button>
                        )}
                        {sellable.has(square.id) && (
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={busy}
                            onClick={() => onAct({ type: 'SELL_HOUSE', squareId: square.id })}
                          >
                            Sell one
                          </Button>
                        )}
                        {mortgageable.has(square.id) && (
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={busy}
                            onClick={() => onAct({ type: 'MORTGAGE', squareId: square.id })}
                          >
                            Mortgage · +{money(mortgageValue)}
                          </Button>
                        )}
                        {redeemable.has(square.id) && (
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={busy}
                            onClick={() => onAct({ type: 'UNMORTGAGE', squareId: square.id })}
                          >
                            Redeem · {money(unmortgageCost(view, square.id))}
                          </Button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          <p className="text-center text-xs text-text-faint">
            Build evenly across a full set. Sell buildings before mortgaging a lot in that set.
          </p>
        </div>
      )}
    </Dialog>
  );
}
