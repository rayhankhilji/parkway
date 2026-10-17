'use client';

import { useEffect, useRef } from 'react';
import { getBoardPack, getSquare, type GameEvent, type PublicGameState } from '@parkway/engine';
import type { PlayerSummary } from '@/lib/apiClient';
import { describeEvent } from '@/lib/format';
import type { FeedLine } from '@/store/useStage';

/**
 * The game so far, in sentences, newest at the bottom.
 *
 * Each action's events are one entry, marked with the colour of whoever caused
 * them. Auto-scrolls only when already at the bottom, so reading back through
 * the game does not get yanked away every time someone rolls.
 */
export function Feed({
  lines,
  state,
  players,
}: {
  readonly lines: readonly FeedLine[];
  readonly state: PublicGameState;
  readonly players: readonly PlayerSummary[];
}) {
  const scroller = useRef<HTMLOListElement>(null);
  const atBottom = useRef(true);

  useEffect(() => {
    const element = scroller.current;
    if (element === null || !atBottom.current) return;
    element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' });
  }, [lines]);

  const pack = getBoardPack(state.boardPackId);
  const context = {
    currency: pack.currencySymbol,
    nameOf: (id: string | null): string =>
      id === null ? 'the bank' : (players.find((player) => player.id === id)?.name ?? 'Someone'),
    squareOf: (squareId: number): string => getSquare(pack, squareId).name,
  };
  const colourOf = (id: string | null): string | null =>
    id === null ? null : (players.find((player) => player.id === id)?.colour ?? null);

  const entries = collapseBidding(lines)
    .map((line) => ({
      seq: line.seq,
      actor: actorOf(line.events),
      sentences: line.events.flatMap((event) => {
        const text = describeEvent(event, context);
        return text === null ? [] : [{ text, tone: toneOf(event) }];
      }),
    }))
    .filter((entry) => entry.sentences.length > 0);

  if (entries.length === 0) {
    return <p className="p-4 text-sm text-text-faint">The game starts here.</p>;
  }

  return (
    <ol
      ref={scroller}
      onScroll={(event) => {
        const element = event.currentTarget;
        atBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 40;
      }}
      className="scrollbar-thin flex h-full flex-col gap-1.5 overflow-y-auto p-3"
      aria-label="Game log"
    >
      {entries.map((entry, index) => {
        const colour = colourOf(entry.actor);
        return (
          <li
            key={entry.seq}
            className={`flex gap-2.5 rounded-xl px-2.5 py-2 ${index === entries.length - 1 ? 'animate-fade-up bg-white/[0.04]' : ''}`}
          >
            <span
              className="mt-1.5 size-2 shrink-0 rounded-full"
              style={{
                background:
                  colour === null ? 'var(--color-text-faint)' : `var(--color-player-${colour})`,
              }}
            />
            <div className="min-w-0 flex-1 space-y-0.5">
              {entry.sentences.map((sentence, i) => (
                <p
                  key={i}
                  className={
                    sentence.tone === 'good'
                      ? 'text-[13px] leading-snug text-[#a8e8c0]'
                      : sentence.tone === 'bad'
                        ? 'text-[13px] leading-snug text-[#ffb9b0]'
                        : sentence.tone === 'gold'
                          ? 'text-[13px] leading-snug text-gold-bright'
                          : 'text-[13px] leading-snug text-text-muted'
                  }
                >
                  {sentence.text}
                </p>
              ))}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * A bidding war is dozens of one-bid actions. Run together, consecutive
 * bid-only entries keep just each bidder's highest bid and any passes, so the
 * log reads "Bo bid £240. Ada passed." instead of scrolling for a screen.
 */
function collapseBidding(lines: readonly FeedLine[]): FeedLine[] {
  const isBidding = (line: FeedLine): boolean =>
    line.events.length > 0 &&
    line.events.every((event) => event.type === 'BID_PLACED' || event.type === 'BID_PASSED');

  const out: FeedLine[] = [];
  let run: FeedLine[] = [];

  const flush = () => {
    if (run.length === 0) return;
    const highest = new Map<string, GameEvent>();
    const order: string[] = [];
    for (const line of run) {
      for (const event of line.events) {
        if (event.type !== 'BID_PLACED' && event.type !== 'BID_PASSED') continue;
        const key = `${event.type}:${event.playerId}`;
        if (!highest.has(key)) order.push(key);
        highest.set(key, event);
      }
    }
    const last = run[run.length - 1];
    out.push({
      seq: last?.seq ?? 0,
      events: order.flatMap((key) => {
        const event = highest.get(key);
        return event === undefined ? [] : [event];
      }),
    });
    run = [];
  };

  for (const line of lines) {
    if (isBidding(line)) {
      run.push(line);
    } else {
      flush();
      out.push(line);
    }
  }
  flush();
  return out;
}

function actorOf(events: readonly GameEvent[]): string | null {
  for (const event of events) {
    if ('playerId' in event) return event.playerId;
    if (event.type === 'RENT_PAID') return event.from;
    if (event.type === 'TRADE_OFFERED') return event.fromId;
    if (event.type === 'DEBT_INCURRED' || event.type === 'DEBT_SETTLED') return event.debtorId;
  }
  return null;
}

function toneOf(event: GameEvent): 'good' | 'bad' | 'gold' | 'plain' {
  switch (event.type) {
    case 'PROPERTY_PURCHASED':
    case 'AUCTION_WON':
    case 'TRADE_ACCEPTED':
    case 'HOUSE_BUILT':
    case 'HOTEL_BUILT':
      return 'good';
    case 'RENT_PAID':
    case 'TAX_PAID':
    case 'SENT_TO_JAIL':
    case 'DEBT_INCURRED':
    case 'BANKRUPTED':
      return 'bad';
    case 'SALARY_PAID':
    case 'POT_COLLECTED':
    case 'GAME_OVER':
    case 'GAME_STARTED':
      return 'gold';
    default:
      return 'plain';
  }
}
