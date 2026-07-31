import {
  createRng,
  nextInt,
  type Action,
  type LegalAction,
  type PlayerId,
  type PublicGameState,
  type RngState,
  type SquareId,
  type TradeSide,
} from '@parkway/engine';
import {
  acquisitionValue,
  boardOf,
  buildReturn,
  holdings,
  liquidity,
  ownableAt,
  profiles,
  worstExposure,
  type Difficulty,
  type Profile,
} from './valuation';

/**
 * The bot, as a pure function from a position to a move.
 *
 * It is a client, not part of the rules. It receives exactly what a human
 * receives — the public state and the actions the server says are legal — and
 * returns one of them. That is why bots need no engine changes at all: PRD F14
 * anticipated it, and getLegalActions turns out to be the whole interface.
 *
 * Deterministic on purpose. Given the same position and the same seed it plays
 * the same move, so a bot game replays exactly like any other and a complaint
 * about a bot's choice can be reproduced rather than argued about.
 */

export type BotView = {
  readonly state: PublicGameState;
  readonly playerId: PlayerId;
  readonly legalActions: readonly LegalAction[];
  /** Server clock, for anything with a deadline. */
  readonly now: number;
};

export type Bot = {
  readonly playerId: PlayerId;
  readonly difficulty: Difficulty;
  readonly decide: (view: BotView) => Action | null;
};

/**
 * The order the bot considers what it has been offered.
 *
 * Obligations first, because they block everything; then the turn; then the
 * things it may do at leisure. Within a category the choice is made on value,
 * never on this order.
 */
const priority: readonly LegalAction['type'][] = [
  'SETTLE_DEBT',
  'SELL_HOUSE',
  'MORTGAGE',
  'DECLARE_BANKRUPTCY',
  'PLACE_BID',
  'PASS_BID',
  'ACCEPT_TRADE',
  'DECLINE_TRADE',
  'BUY_PROPERTY',
  'DECLINE_PURCHASE',
  'USE_JAIL_CARD',
  'PAY_JAIL_FINE',
  'ROLL_FOR_JAIL',
  'BUILD_HOUSE',
  'UNMORTGAGE',
  'OFFER_TRADE',
  'ROLL_DICE',
  'END_TURN',
];

export function createBot(playerId: PlayerId, difficulty: Difficulty, seed = 1): Bot {
  const profile = profiles[difficulty];
  let rng: RngState = createRng(seed);

  /*
   * The last offer this bot made.
   *
   * Without it the bot livelocks. Proposing sits above rolling in the order
   * below, so a bot that wants a lot proposes, is declined, and — the position
   * being unchanged and the opponent's valuation being deterministic — proposes
   * exactly the same deal again, forever. The game never stalls, because moves
   * are always available, but every action is spent on an offer already refused.
   *
   * Remembering the last one and refusing to repeat it is enough: after a decline
   * the bot moves on to rolling, and the memory clears at the end of its turn so
   * a genuinely changed position can be tried again.
   */
  let lastOffer: string | null = null;

  /** A coin weighted by the profile's blunder rate. */
  const blunders = (): boolean => {
    if (profile.noise === 0) return false;
    const [roll, next] = nextInt(rng, 1000);
    rng = next;
    return roll < profile.noise * 1000;
  };

  const pick = <T>(items: readonly T[]): T | null => {
    if (items.length === 0) return null;
    const [index, next] = nextInt(rng, items.length);
    rng = next;
    return items[index] ?? null;
  };

  const remember = {
    saw: (key: string): boolean => lastOffer === key,
    note: (key: string): void => {
      lastOffer = key;
    },
    clear: (): void => {
      lastOffer = null;
    },
  };

  return {
    playerId,
    difficulty,
    decide: (view) => {
      const action = decide(view, profile, blunders, pick, remember);
      if (action?.type === 'END_TURN') remember.clear();
      return action;
    },
  };
}

/** What the bot carries between decisions. Deliberately almost nothing. */
type Memory = {
  readonly saw: (key: string) => boolean;
  readonly note: (key: string) => void;
  readonly clear: () => void;
};

function decide(
  view: BotView,
  profile: Profile,
  blunders: () => boolean,
  pick: <T>(items: readonly T[]) => T | null,
  memory: Memory,
): Action | null {
  const offered = new Map<LegalAction['type'], LegalAction>();
  for (const legal of view.legalActions) offered.set(legal.type, legal);

  for (const type of priority) {
    const legal = offered.get(type);
    if (legal === undefined) continue;

    const action = consider(view, legal, profile, blunders, pick, offered, memory);
    if (action !== null) return action;
  }

  return null;
}

function consider(
  view: BotView,
  legal: LegalAction,
  profile: Profile,
  blunders: () => boolean,
  pick: <T>(items: readonly T[]) => T | null,
  offered: ReadonlyMap<LegalAction['type'], LegalAction>,
  memory: Memory,
): Action | null {
  const { state, playerId } = view;
  const me = state.players[playerId];
  if (me === undefined) return null;

  switch (legal.type) {
    // ---- Obligations -------------------------------------------------------

    case 'SETTLE_DEBT':
      // Always. Being offered this means the money is already there.
      return { type: 'SETTLE_DEBT' };

    case 'SELL_HOUSE': {
      // Only to raise money, and from the lot whose next house earns least.
      if (state.phase.kind !== 'awaiting_debt') return null;
      const worst = rankBy(legal.squareIds, (id) => -buildReturn(state, id, playerId));
      return worst === null ? null : { type: 'SELL_HOUSE', squareId: worst };
    }

    case 'MORTGAGE': {
      if (state.phase.kind !== 'awaiting_debt') return null;
      // Mortgage what earns least first, so the money-makers stay live longest.
      const worst = rankBy(legal.squareIds, (id) => -incomeOf(state, id, playerId));
      return worst === null ? null : { type: 'MORTGAGE', squareId: worst };
    }

    case 'DECLARE_BANKRUPTCY':
      // Only once there is genuinely nothing left to sell or mortgage. Those
      // come first in the priority list, so reaching here means they were not
      // offered at all.
      return offered.has('MORTGAGE') || offered.has('SELL_HOUSE')
        ? null
        : { type: 'DECLARE_BANKRUPTCY' };

    // ---- Auctions ----------------------------------------------------------

    case 'PLACE_BID': {
      const worth = acquisitionValue(state, legal.squareId, playerId, profile);
      const ceiling = Math.min(worth * profile.bidCeiling, me.cash - profile.reserve);

      if (blunders()) {
        // A poor bidder overpays for something they do not need.
        return legal.minimum <= me.cash ? { type: 'PLACE_BID', amount: legal.minimum } : null;
      }

      if (legal.minimum > ceiling) return null;
      // Bid the minimum: paying more than needed to hold the lead is money lost.
      return { type: 'PLACE_BID', amount: legal.minimum };
    }

    case 'PASS_BID':
      // Reached only when bidding was declined above, or was not affordable.
      return { type: 'PASS_BID' };

    // ---- Buying ------------------------------------------------------------

    case 'BUY_PROPERTY': {
      const worth = acquisitionValue(state, legal.squareId, playerId, profile);
      const affordable = me.cash - legal.price >= profile.reserve;
      const wanted = worth >= legal.price;

      if (blunders()) return wanted ? null : { type: 'BUY_PROPERTY' };
      return wanted && affordable ? { type: 'BUY_PROPERTY' } : null;
    }

    case 'DECLINE_PURCHASE':
      return { type: 'DECLINE_PURCHASE' };

    // ---- The gaol ----------------------------------------------------------

    case 'USE_JAIL_CARD':
      // Free, so spend it — unless sitting tight is deliberately the plan.
      return sittingTight(view, profile) ? null : { type: 'USE_JAIL_CARD' };

    case 'PAY_JAIL_FINE':
      return sittingTight(view, profile) ? null : { type: 'PAY_JAIL_FINE' };

    case 'ROLL_FOR_JAIL':
      // Rolling is free and might get them out anyway.
      return { type: 'ROLL_FOR_JAIL' };

    // ---- Development -------------------------------------------------------

    case 'BUILD_HOUSE': {
      const best = rankBy(legal.squareIds, (id) => buildReturn(state, id, playerId));
      if (best === null) return null;

      const square = ownableAt(state, best);
      const cost = square !== null && square.kind === 'property' ? square.buildCost : 0;
      if (me.cash - cost < profile.reserve) return null;

      if (blunders()) {
        const anywhere = pick(legal.squareIds);
        return anywhere === null ? null : { type: 'BUILD_HOUSE', squareId: anywhere };
      }
      return { type: 'BUILD_HOUSE', squareId: best };
    }

    case 'UNMORTGAGE': {
      // Only with money to spare: an unmortgaged lot earns nothing if the next
      // rent bill bankrupts you.
      const best = rankBy(legal.squareIds, (id) => incomeOf(state, id, playerId));
      if (best === null) return null;
      const square = ownableAt(state, best);
      const cost = square === null ? 0 : Math.ceil(square.mortgageValue * 1.1);
      return me.cash - cost >= profile.reserve * 2 ? { type: 'UNMORTGAGE', squareId: best } : null;
    }

    // ---- Trading -----------------------------------------------------------

    case 'ACCEPT_TRADE': {
      const offer = state.openTrade;
      if (offer === null) return null;
      const gain =
        sideValue(state, offer.offered, playerId, profile) -
        sideValue(state, offer.requested, playerId, profile);
      if (blunders()) return gain > 0 ? null : { type: 'ACCEPT_TRADE' };
      return gain > 0 ? { type: 'ACCEPT_TRADE' } : null;
    }

    case 'DECLINE_TRADE':
      return { type: 'DECLINE_TRADE' };

    case 'OFFER_TRADE': {
      const proposal = proposeTrade(view, legal.candidateIds, profile);
      if (proposal === null || proposal.type !== 'OFFER_TRADE') return null;

      // Never the same deal twice running: the position has not changed and the
      // opponent's answer is deterministic, so it would be refused identically.
      const key = `${proposal.toId}:${proposal.offered.cash}:${proposal.requested.deedIds.join(',')}`;
      if (memory.saw(key)) return null;
      memory.note(key);
      return proposal;
    }

    // ---- Turn flow ---------------------------------------------------------

    case 'ROLL_DICE':
      return { type: 'ROLL_DICE' };

    case 'END_TURN':
      return { type: 'END_TURN' };

    default:
      return null;
  }
}

function incomeOf(state: PublicGameState, squareId: SquareId, playerId: PlayerId): number {
  const square = ownableAt(state, squareId);
  if (square === null) return 0;
  return acquisitionValue(state, squareId, playerId, profiles.steady);
}

function rankBy(squareIds: readonly SquareId[], score: (id: SquareId) => number): SquareId | null {
  let best: SquareId | null = null;
  let bestScore = -Infinity;
  for (const id of squareIds) {
    const value = score(id);
    if (value > bestScore) {
      bestScore = value;
      best = id;
    }
  }
  return best;
}

/**
 * Whether the gaol is currently the safest place to be.
 *
 * Late in a game, with hotels on the board, not moving is the strongest move
 * available: rent cannot be charged to a token that does not travel. Early on,
 * when there is property to buy, it is the worst.
 */
function sittingTight(view: BotView, profile: Profile): boolean {
  if (!profile.usesJailStrategy) return false;

  const { state, playerId } = view;
  const unowned = boardOf(state)
    .squares.filter((square) => state.deeds[square.id] !== undefined)
    .filter((square) => state.deeds[square.id]?.ownerId === null).length;

  // While there is still a decent amount to buy, moving is worth the risk.
  if (unowned > 6) return false;

  const me = state.players[playerId];
  if (me === undefined) return false;

  // Dangerous once one bad landing costs a serious share of what they could raise.
  return worstExposure(state, playerId) > liquidity(state, playerId) * 0.35;
}

/** What one side of a trade is worth to this player. */
function sideValue(
  state: PublicGameState,
  side: TradeSide,
  playerId: PlayerId,
  profile: Profile,
): number {
  const deeds = side.deedIds.reduce(
    (total, id) => total + acquisitionValue(state, id, playerId, profile),
    0,
  );
  // A release card is worth roughly a fine plus the turn it saves.
  const cards = side.jailCards * 75;
  return side.cash + deeds + cards;
}

/**
 * Looks for a trade worth proposing.
 *
 * The bot only offers deals that complete one of its own groups, because that is
 * the only trade reliably worth making. It offers cash above the lot's value, so
 * the deal is attractive to a valuation-driven opponent as well — a bot that only
 * proposes trades good for itself never gets one accepted.
 */
function proposeTrade(
  view: BotView,
  candidateIds: readonly PlayerId[],
  profile: Profile,
): Action | null {
  const { state, playerId } = view;
  const me = state.players[playerId];
  if (me === undefined) return null;

  const pack = boardOf(state);

  for (const group of pack.groups) {
    const mine = group.memberIds.filter((id) => state.deeds[id]?.ownerId === playerId);
    const missing = group.memberIds.filter((id) => state.deeds[id]?.ownerId !== playerId);

    // Only interesting when one lot away from a complete group.
    if (missing.length !== 1 || mine.length === 0) continue;

    const wanted = missing[0];
    if (wanted === undefined) continue;

    const ownerId = state.deeds[wanted]?.ownerId;
    if (ownerId === null || ownerId === undefined || !candidateIds.includes(ownerId)) continue;

    const deed = state.deeds[wanted];
    if (deed === undefined || deed.houses > 0 || deed.hotels > 0) continue;

    const worthToMe = acquisitionValue(state, wanted, playerId, profile);
    const worthToThem = acquisitionValue(state, wanted, ownerId, profile);

    // Offer enough to be clearly better for them than keeping it, but not more
    // than the lot is worth here.
    const offerCash = Math.ceil(Math.min(worthToMe * 0.8, Math.max(worthToThem * 1.3, 1)));
    if (offerCash <= 0 || me.cash - offerCash < profile.reserve) continue;

    return {
      type: 'OFFER_TRADE',
      toId: ownerId,
      offered: { cash: offerCash, deedIds: [], jailCards: 0 },
      requested: { cash: 0, deedIds: [wanted], jailCards: 0 },
    };
  }

  return null;
}

/** Everything the bot holds, for a UI that wants to explain its position. */
export function botHoldings(state: PublicGameState, playerId: PlayerId): readonly SquareId[] {
  return holdings(state, playerId).map((square) => square.id);
}
