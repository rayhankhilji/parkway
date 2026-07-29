import { describe, expect, it } from 'vitest';
import { parseAction, parseGameConfig } from '../../src/actions/parse';

/**
 * The parser's job is to reject anything a well-behaved client would never send,
 * so these tests are mostly about the rejections. A parse failure means a broken
 * client and produces a 400; an illegal-but-well-formed move is a different type
 * entirely and produces a 422 (→ D15). Nothing here should ever return a
 * RuleViolation.
 */

function expectMalformed(input: unknown, path: string): void {
  const result = parseAction(input);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.code).toBe('MALFORMED_ACTION');
    expect(result.error.path).toBe(path);
  }
}

describe('parseAction', () => {
  it('accepts every action that carries nothing but a type', () => {
    const bare = [
      'START_GAME',
      'ROLL_DICE',
      'BUY_PROPERTY',
      'DECLINE_PURCHASE',
      'PASS_BID',
      'AUCTION_TIMEOUT',
      'PAY_JAIL_FINE',
      'USE_JAIL_CARD',
      'ROLL_FOR_JAIL',
      'ACCEPT_TRADE',
      'DECLINE_TRADE',
      'WITHDRAW_TRADE',
      'SETTLE_DEBT',
      'DECLARE_BANKRUPTCY',
      'CONCEDE',
      'END_TURN',
    ];
    for (const type of bare) {
      const result = parseAction({ type });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toEqual({ type });
    }
  });

  it('ignores fields a bare action does not declare', () => {
    const result = parseAction({ type: 'ROLL_DICE', squareId: 4, nonsense: true });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ type: 'ROLL_DICE' });
  });

  it('accepts the square-carrying actions', () => {
    for (const type of ['BUILD_HOUSE', 'SELL_HOUSE', 'MORTGAGE', 'UNMORTGAGE']) {
      const result = parseAction({ type, squareId: 11 });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toEqual({ type, squareId: 11 });
    }
  });

  it('rejects a square id that is missing, fractional, negative or not a number', () => {
    expectMalformed({ type: 'MORTGAGE' }, 'action.squareId');
    expectMalformed({ type: 'MORTGAGE', squareId: 1.5 }, 'action.squareId');
    expectMalformed({ type: 'MORTGAGE', squareId: -1 }, 'action.squareId');
    expectMalformed({ type: 'MORTGAGE', squareId: '11' }, 'action.squareId');
    expectMalformed({ type: 'MORTGAGE', squareId: null }, 'action.squareId');
  });

  it('accepts a bid and rejects a malformed amount', () => {
    const result = parseAction({ type: 'PLACE_BID', amount: 240 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ type: 'PLACE_BID', amount: 240 });

    expectMalformed({ type: 'PLACE_BID' }, 'action.amount');
    expectMalformed({ type: 'PLACE_BID', amount: -5 }, 'action.amount');
    expectMalformed({ type: 'PLACE_BID', amount: 12.5 }, 'action.amount');
    expectMalformed({ type: 'PLACE_BID', amount: Number.MAX_SAFE_INTEGER + 2 }, 'action.amount');
  });

  it('accepts a complete trade offer', () => {
    const action = {
      type: 'OFFER_TRADE',
      toId: 'bo',
      offered: { cash: 100, deedIds: [1, 3], jailCards: 0 },
      requested: { cash: 0, deedIds: [11], jailCards: 1 },
    };
    const result = parseAction(action);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(action);
  });

  it('reports which part of a trade offer is wrong', () => {
    const valid = { cash: 0, deedIds: [], jailCards: 0 };
    expectMalformed({ type: 'OFFER_TRADE', offered: valid, requested: valid }, 'action.toId');
    expectMalformed(
      { type: 'OFFER_TRADE', toId: 'bo', offered: {}, requested: valid },
      'action.offered.cash',
    );
    expectMalformed(
      {
        type: 'OFFER_TRADE',
        toId: 'bo',
        offered: { cash: 0, deedIds: 'all', jailCards: 0 },
        requested: valid,
      },
      'action.offered.deedIds',
    );
    expectMalformed(
      {
        type: 'OFFER_TRADE',
        toId: 'bo',
        offered: { cash: 0, deedIds: [1, -2], jailCards: 0 },
        requested: valid,
      },
      'action.offered.deedIds[1]',
    );
    expectMalformed(
      { type: 'OFFER_TRADE', toId: 'bo', offered: valid, requested: { cash: 0, deedIds: [] } },
      'action.requested.jailCards',
    );
  });

  it('rejects a trade listing the same deed twice', () => {
    expectMalformed(
      {
        type: 'OFFER_TRADE',
        toId: 'bo',
        offered: { cash: 0, deedIds: [5, 5], jailCards: 0 },
        requested: { cash: 0, deedIds: [], jailCards: 0 },
      },
      'action.offered.deedIds',
    );
  });

  it('rejects anything that is not an action-shaped object', () => {
    expectMalformed(null, 'action');
    expectMalformed('ROLL_DICE', 'action');
    expectMalformed([{ type: 'ROLL_DICE' }], 'action');
    expectMalformed(42, 'action');
    expectMalformed({}, 'action.type');
    expectMalformed({ type: 7 }, 'action.type');
  });

  it('rejects an unknown action type by name', () => {
    const result = parseAction({ type: 'FLIP_TABLE' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.path).toBe('action.type');
      expect(result.error.message).toContain('FLIP_TABLE');
    }
  });
});

describe('parseGameConfig', () => {
  const defaults = {
    startingCash: 1500,
    salary: 200,
    freeParkingPot: false,
    incomeTaxMode: 'flat',
    auctionOnDecline: true,
    auctionSeconds: 30,
  };

  it('fills in every default when given nothing', () => {
    for (const input of [undefined, {}]) {
      const result = parseGameConfig(input);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toEqual(defaults);
    }
  });

  it('accepts a fully specified configuration', () => {
    const config = {
      startingCash: 2000,
      salary: 400,
      freeParkingPot: true,
      incomeTaxMode: 'percentage',
      auctionOnDecline: false,
      auctionSeconds: 120,
    };
    const result = parseGameConfig(config);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(config);
  });

  it('rejects an unknown setting rather than ignoring it', () => {
    // Silently dropping a setting the host thought they had chosen is worse than
    // refusing the request (→ API.md).
    const result = parseGameConfig({ doubleRent: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.path).toBe('config.doubleRent');
  });

  it('rejects values outside the permitted set', () => {
    const cases: ReadonlyArray<readonly [Record<string, unknown>, string]> = [
      [{ startingCash: 1750 }, 'config.startingCash'],
      [{ salary: 300 }, 'config.salary'],
      [{ incomeTaxMode: 'sliding' }, 'config.incomeTaxMode'],
      [{ freeParkingPot: 'yes' }, 'config.freeParkingPot'],
      [{ auctionOnDecline: 1 }, 'config.auctionOnDecline'],
      [{ auctionSeconds: 14 }, 'config.auctionSeconds'],
      [{ auctionSeconds: 121 }, 'config.auctionSeconds'],
      [{ auctionSeconds: 30.5 }, 'config.auctionSeconds'],
    ];
    for (const [input, path] of cases) {
      const result = parseGameConfig(input);
      expect(result.ok, `expected ${JSON.stringify(input)} to be rejected`).toBe(false);
      if (!result.ok) expect(result.error.path).toBe(path);
    }
  });

  it('accepts the boundaries of the auction duration range', () => {
    expect(parseGameConfig({ auctionSeconds: 15 }).ok).toBe(true);
    expect(parseGameConfig({ auctionSeconds: 120 }).ok).toBe(true);
  });

  it('rejects a configuration that is not an object', () => {
    const result = parseGameConfig('default');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.path).toBe('config');
  });
});
