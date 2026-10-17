'use client';

import { create } from 'zustand';
import {
  getBoardPack,
  getSquare,
  type BoardPack,
  type DeckId,
  type GameEvent,
} from '@parkway/engine';
import type { GamePayload } from '@/lib/apiClient';
import { formatMoney } from '@/lib/format';
import { haptic, sfx } from '@/lib/sound';

/**
 * The stage: what the table is *showing*, as opposed to what is true.
 *
 * The server (or the local engine) answers instantly. A good board game does
 * not: the dice tumble, the token walks, the card turns over, and only then does
 * the money change hands. This store is the director that turns one burst of
 * structured events into that sequence, then commits the new state.
 *
 * It never decides anything. Every frame is a replay of events the engine
 * already emitted, against positions the engine already computed, so the
 * animation can be skipped at any point — when a tab was in the background, or
 * a backlog builds up — and the board lands in exactly the same place.
 *
 * Controls render from `shown`, never from the newer truth underneath, so a
 * player is never offered a button for a position they have not seen yet.
 */

export type FeedLine = {
  readonly seq: number;
  readonly events: readonly GameEvent[];
};

export type StageItem = {
  readonly game: GamePayload;
  readonly events: readonly GameEvent[];
  readonly seq: number | null;
  /** Replaces the feed outright, after a resync. */
  readonly replaceFeed?: readonly FeedLine[] | undefined;
};

export type BannerTone = 'good' | 'bad' | 'gold' | 'info';

export type Banner = {
  readonly id: number;
  readonly tone: BannerTone;
  readonly title: string;
  readonly detail?: string | undefined;
  readonly colour?: string | undefined;
};

export type Floater = { readonly id: number; readonly playerId: string; readonly amount: number };

export type CardShow = {
  readonly id: number;
  readonly deck: DeckId;
  readonly text: string;
  readonly playerName: string;
  readonly colour: string;
};

type DiceShow = {
  readonly values: readonly [number, number];
  readonly key: number;
  readonly rolling: boolean;
};

type StageState = {
  readonly shown: GamePayload | null;
  readonly feed: readonly FeedLine[];
  readonly busy: boolean;
  /** Bumped every time the queue drains, so the bot driver knows to move. */
  readonly idleTick: number;
  /** Token positions mid-animation. Absent means "where the state says". */
  readonly tokenAt: Readonly<Record<string, number>>;
  readonly hopKey: Readonly<Record<string, number>>;
  readonly flying: string | null;
  readonly dice: DiceShow | null;
  readonly card: CardShow | null;
  readonly banners: readonly Banner[];
  readonly floaters: readonly Floater[];
  readonly stamps: Readonly<Record<number, number>>;
  readonly landed: number | null;
  readonly fast: boolean;
};

type StageActions = {
  reset: (game: GamePayload | null, feed: readonly FeedLine[]) => void;
  push: (item: StageItem) => void;
  /** Cut the current pause short — a click on a revealed card, say. */
  skip: () => void;
  setFast: (fast: boolean) => void;
};

const fastKey = 'parkway:fast';

function readFast(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(fastKey) === '1';
  } catch {
    return false;
  }
}

let queue: StageItem[] = [];
let running = false;
let generation = 0;
let counter = 0;
let skipWait: (() => void) | null = null;

const nextId = (): number => {
  counter += 1;
  return counter;
};

function reducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  );
}

export const useStage = create<StageState & StageActions>((set, get) => {
  /** A pause, scaled by the speed setting, optionally skippable. */
  const wait = (ms: number, skippable = false): Promise<void> =>
    new Promise((resolve) => {
      const scaled = get().fast ? ms * 0.55 : ms;
      const timer = setTimeout(() => {
        if (skippable) skipWait = null;
        resolve();
      }, scaled);
      if (skippable) {
        skipWait = () => {
          clearTimeout(timer);
          skipWait = null;
          resolve();
        };
      }
    });

  const banner = (b: Omit<Banner, 'id'>): void => {
    const id = nextId();
    set({ banners: [...get().banners.slice(-2), { ...b, id }] });
    setTimeout(() => {
      set({ banners: get().banners.filter((existing) => existing.id !== id) });
    }, 2300);
  };

  const commit = (item: StageItem): void => {
    const prev = get().shown;
    const floaters: Floater[] = [];

    if (prev?.publicState != null && item.game.publicState != null) {
      for (const [id, player] of Object.entries(item.game.publicState.players)) {
        const before = prev.publicState.players[id]?.cash;
        if (before !== undefined && before !== player.cash) {
          floaters.push({ id: nextId(), playerId: id, amount: player.cash - before });
        }
      }
    }

    const feed =
      item.replaceFeed !== undefined
        ? item.replaceFeed
        : item.seq !== null && item.events.length > 0
          ? [...get().feed, { seq: item.seq, events: item.events }]
          : get().feed;

    set({
      shown: item.game,
      feed: feed.slice(-400),
      tokenAt: {},
      flying: null,
      floaters: [...get().floaters, ...floaters],
    });

    if (floaters.length > 0) {
      const ids = new Set(floaters.map((floater) => floater.id));
      setTimeout(() => {
        set({ floaters: get().floaters.filter((floater) => !ids.has(floater.id)) });
      }, 1500);
    }
  };

  const animate = async (prev: GamePayload, item: StageItem, run: number): Promise<void> => {
    const before = prev.publicState;
    const after = item.game.publicState;
    if (before === null || after === null) return;

    const pack = getBoardPack(after.boardPackId);
    const you = item.game.you.playerId;
    const nameOf = (id: string | null): string =>
      id === null ? 'the bank' : (item.game.players.find((p) => p.id === id)?.name ?? 'Someone');
    const colourOf = (id: string): string =>
      item.game.players.find((p) => p.id === id)?.colour ?? 'slate';
    const squareName = (id: number): string => getSquare(pack, id).name;
    const money = (amount: number): string => formatMoney(amount, pack.currencySymbol);
    const reduced = reducedMotion();
    const alive = (): boolean => run === generation;

    // Walk from where the board currently shows each token.
    const positions: Record<string, number> = {};
    for (const [id, player] of Object.entries(before.players)) positions[id] = player.position;

    for (const event of item.events) {
      if (!alive()) return;

      switch (event.type) {
        case 'GAME_STARTED': {
          const first = event.turnOrder[0];
          banner({
            tone: 'gold',
            title: 'Game on',
            detail:
              first === undefined
                ? undefined
                : `${first === you ? 'You go' : `${nameOf(first)} goes`} first`,
          });
          await wait(900);
          break;
        }

        case 'DICE_ROLLED': {
          const key = (get().dice?.key ?? 0) + 1;
          set({ dice: { values: event.dice, key, rolling: true }, landed: null });
          sfx.roll();
          haptic(20);
          await wait(reduced ? 300 : 1050);
          set({ dice: { values: event.dice, key, rolling: false } });
          if (event.isDouble) {
            banner({ tone: 'info', title: 'Doubles!', detail: 'Roll again after this' });
          }
          await wait(160);
          break;
        }

        case 'TOKEN_MOVED': {
          const n = pack.squares.length;
          const from = positions[event.playerId] ?? event.from;
          const forward = (event.to - from + n) % n;
          const backward = (from - event.to + n) % n;
          const goesBack =
            !event.passedStart && backward > 0 && backward <= 3 && backward < forward;
          const steps = goesBack ? backward : forward;

          if (reduced || steps === 0 || (get().fast && steps > 14)) {
            positions[event.playerId] = event.to;
            set({ tokenAt: { ...get().tokenAt, [event.playerId]: event.to } });
            await wait(260);
          } else {
            const per = Math.max(95, Math.min(185, 1500 / steps));
            for (let step = 1; step <= steps; step += 1) {
              if (!alive()) return;
              const at = goesBack ? (from - step + n) % n : (from + step) % n;
              positions[event.playerId] = at;
              set({
                tokenAt: { ...get().tokenAt, [event.playerId]: at },
                hopKey: {
                  ...get().hopKey,
                  [event.playerId]: (get().hopKey[event.playerId] ?? 0) + 1,
                },
              });
              sfx.hop(step);
              await wait(per);
            }
          }
          set({ landed: event.to });
          await wait(200);
          break;
        }

        case 'SENT_TO_JAIL': {
          positions[event.playerId] = pack.jail.squareId;
          set({
            flying: event.playerId,
            tokenAt: { ...get().tokenAt, [event.playerId]: pack.jail.squareId },
          });
          sfx.jail();
          haptic([30, 40, 30]);
          banner({
            tone: 'bad',
            title:
              event.playerId === you ? 'Off to the Gaol' : `${nameOf(event.playerId)} is jailed`,
            detail:
              event.reason === 'three_doubles'
                ? 'Three doubles in a row'
                : event.reason === 'card'
                  ? 'By order of the card'
                  : "The Magistrates' Court has spoken",
          });
          await wait(1100);
          set({ flying: null });
          break;
        }

        case 'CARD_DRAWN': {
          const deck = event.deck === 'chance' ? pack.decks.chance : pack.decks.chest;
          const card = deck.find((candidate) => candidate.id === event.cardId);
          set({
            card: {
              id: nextId(),
              deck: event.deck,
              text: card?.text ?? '',
              playerName: event.playerId === you ? 'You' : nameOf(event.playerId),
              colour: colourOf(event.playerId),
            },
          });
          sfx.card();
          await wait(2800, true);
          set({ card: null });
          await wait(220);
          break;
        }

        case 'SALARY_PAID':
          sfx.gain();
          banner({
            tone: 'gold',
            title: `+${money(event.amount)}`,
            detail: `${nameOf(event.playerId)} passed ${squareName(pack.startSquareId)}`,
          });
          await wait(650);
          break;

        case 'PROPERTY_PURCHASED':
          set({ stamps: { ...get().stamps, [event.squareId]: nextId() } });
          sfx.buy();
          haptic(25);
          banner({
            tone: 'good',
            title: `${event.playerId === you ? 'You' : nameOf(event.playerId)} bought ${squareName(event.squareId)}`,
            detail: money(event.price),
            colour: colourOf(event.playerId),
          });
          await wait(900);
          break;

        case 'PURCHASE_DECLINED':
          await wait(200);
          break;

        case 'RENT_PAID':
          sfx.pay();
          banner({
            tone: 'bad',
            title: `Rent · ${money(event.amount)}`,
            detail: `${nameOf(event.from)} → ${nameOf(event.to)}`,
            colour: colourOf(event.to),
          });
          await wait(1000);
          break;

        case 'TAX_PAID':
          sfx.pay();
          banner({
            tone: 'bad',
            title: `${squareName(event.squareId)}`,
            detail: `${nameOf(event.playerId)} paid ${money(event.amount)}`,
          });
          await wait(900);
          break;

        case 'AUCTION_OPENED':
          sfx.gavel();
          banner({ tone: 'gold', title: 'Up for auction', detail: squareName(event.squareId) });
          await wait(700);
          break;

        case 'BID_PLACED':
          sfx.bid();
          break;

        case 'AUCTION_WON':
          sfx.gavel();
          set({ stamps: { ...get().stamps, [event.squareId]: nextId() } });
          banner({
            tone: 'gold',
            title: `Sold to ${event.playerId === you ? 'you' : nameOf(event.playerId)}`,
            detail: `${squareName(event.squareId)} for ${money(event.amount)}`,
            colour: colourOf(event.playerId),
          });
          await wait(1100);
          break;

        case 'AUCTION_UNSOLD':
          banner({
            tone: 'info',
            title: 'No bids',
            detail: `${squareName(event.squareId)} stays with the bank`,
          });
          await wait(800);
          break;

        case 'HOUSE_BUILT':
        case 'HOTEL_BUILT':
          set({ stamps: { ...get().stamps, [event.squareId]: nextId() } });
          sfx.build();
          await wait(320);
          break;

        case 'BUILDING_SOLD':
        case 'MORTGAGED':
        case 'UNMORTGAGED':
          sfx.click();
          await wait(200);
          break;

        case 'TRADE_OFFERED':
          if (event.toId === you) {
            sfx.yourTurn();
            haptic([15, 60, 15]);
          }
          banner({
            tone: 'info',
            title: 'Trade offered',
            detail: `${nameOf(event.fromId)} → ${nameOf(event.toId)}`,
          });
          await wait(500);
          break;

        case 'TRADE_ACCEPTED':
          sfx.gain();
          banner({ tone: 'good', title: 'Deal!', detail: 'The trade went through' });
          await wait(800);
          break;

        case 'TRADE_DECLINED':
          banner({ tone: 'info', title: 'Trade declined' });
          await wait(400);
          break;

        case 'DEBT_INCURRED':
          sfx.pay();
          banner({
            tone: 'bad',
            title: `${event.debtorId === you ? 'You owe' : `${nameOf(event.debtorId)} owes`} ${money(event.amount)}`,
            detail: 'Sell or mortgage to raise the money',
          });
          await wait(1000);
          break;

        case 'BANKRUPTED':
          sfx.bust();
          haptic([50, 50, 80]);
          banner({
            tone: 'bad',
            title: `${event.playerId === you ? 'You are' : `${nameOf(event.playerId)} is`} bankrupt`,
          });
          await wait(1500);
          break;

        case 'POT_COLLECTED':
          sfx.gain();
          banner({
            tone: 'gold',
            title: `Jackpot! +${money(event.amount)}`,
            detail: nameOf(event.playerId),
          });
          await wait(900);
          break;

        case 'JAIL_ATTEMPT_FAILED':
          banner({
            tone: 'info',
            title: 'No double',
            detail: `Still in the Gaol · attempt ${event.attempt}`,
          });
          await wait(700);
          break;

        case 'LEFT_JAIL':
          if (event.method !== 'doubles') sfx.pay();
          banner({
            tone: 'good',
            title: `${event.playerId === you ? 'You are' : `${nameOf(event.playerId)} is`} free`,
          });
          await wait(500);
          break;

        case 'TURN_ENDED':
          if (event.nextPlayerId === you) {
            sfx.yourTurn();
            haptic(15);
            banner({ tone: 'gold', title: 'Your turn' });
          }
          set({ landed: null });
          await wait(260);
          break;

        case 'GAME_OVER':
          sfx.win();
          await wait(300);
          break;

        default:
          break;
      }
    }
  };

  const run = async (): Promise<void> => {
    if (running) return;
    running = true;
    set({ busy: true });
    const myGeneration = generation;

    while (queue.length > 0 && myGeneration === generation) {
      const item = queue.shift();
      if (item === undefined) break;
      const prev = get().shown;

      // A backlog — a background tab, a burst of bot moves — is fast-forwarded
      // rather than replayed at length. The board still lands correctly.
      const skipAnimation =
        prev === null ||
        item.events.length === 0 ||
        queue.length > 5 ||
        (typeof document !== 'undefined' && document.hidden);

      if (!skipAnimation) {
        await animate(prev, item, myGeneration);
      }
      if (myGeneration !== generation) break;
      commit(item);
      if (!skipAnimation) await wait(120);
    }

    running = false;
    if (myGeneration === generation) {
      set({ busy: false, idleTick: get().idleTick + 1, tokenAt: {} });
    }
  };

  return {
    shown: null,
    feed: [],
    busy: false,
    idleTick: 0,
    tokenAt: {},
    hopKey: {},
    flying: null,
    dice: null,
    card: null,
    banners: [],
    floaters: [],
    stamps: {},
    landed: null,
    fast: readFast(),

    reset: (game, feed) => {
      generation += 1;
      queue = [];
      running = false;
      skipWait = null;
      const roll = game?.publicState?.turn.lastRoll ?? null;
      set({
        shown: game,
        feed,
        busy: false,
        tokenAt: {},
        flying: null,
        card: null,
        banners: [],
        floaters: [],
        landed: null,
        dice: roll === null ? null : { values: roll, key: 0, rolling: false },
        idleTick: get().idleTick + 1,
      });
    },

    push: (item) => {
      queue.push(item);
      void run();
    },

    skip: () => {
      skipWait?.();
    },

    setFast: (fast) => {
      try {
        window.localStorage.setItem(fastKey, fast ? '1' : '0');
      } catch {
        // Not persisted; still applies for this session.
      }
      set({ fast });
    },
  };
});

/** The board pack for whatever is on stage. */
export function stagePack(game: GamePayload | null): BoardPack | null {
  const state = game?.publicState;
  return state == null ? null : getBoardPack(state.boardPackId);
}
