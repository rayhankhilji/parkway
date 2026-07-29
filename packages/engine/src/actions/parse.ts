import { malformed, type MalformedAction } from '../errors.js';
import { err, ok, type Result } from '../result.js';
import type { GameConfig, TradeSide } from '../state/types.js';
import type { Action } from './types.js';

/**
 * Turning untrusted JSON into an Action.
 *
 * The architecture originally put zod schemas in this package, which collides
 * with the engine's zero-dependency contract. That contract is the one holding
 * everything else up — it is what lets the engine be imported, replayed and
 * tested without a toolchain, and what guarantees the reducer cannot acquire I/O
 * through a transitive dependency. So the parsers are written by hand instead
 * (→ D14). There are about twenty of them and each is a few lines.
 *
 * A parse failure is not a rule violation. It means the client sent something
 * structurally impossible, which the API answers with 400, where an illegal but
 * well-formed move gets 422. Keeping the two error types apart is what lets the
 * route pick a status from the type rather than by matching on a code (→ D15).
 */

type Parsed<T> = Result<T, MalformedAction>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseInteger(value: unknown, path: string): Parsed<number> {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return err(malformed(path, 'Expected a whole number.'));
  }
  // Beyond this range integers stop being exact, and money must be exact.
  if (!Number.isSafeInteger(value)) {
    return err(malformed(path, 'Number is out of range.'));
  }
  return ok(value);
}

function parseNonNegativeInteger(value: unknown, path: string): Parsed<number> {
  const parsed = parseInteger(value, path);
  if (!parsed.ok) return parsed;
  if (parsed.value < 0) {
    return err(malformed(path, 'Expected a value of zero or more.'));
  }
  return parsed;
}

function parseString(value: unknown, path: string): Parsed<string> {
  if (typeof value !== 'string') {
    return err(malformed(path, 'Expected a string.'));
  }
  return ok(value);
}

function parseBoolean(value: unknown, path: string): Parsed<boolean> {
  if (typeof value !== 'boolean') {
    return err(malformed(path, 'Expected true or false.'));
  }
  return ok(value);
}

function parseOneOf<const T extends readonly unknown[]>(
  value: unknown,
  path: string,
  allowed: T,
): Parsed<T[number]> {
  if (!allowed.includes(value)) {
    return err(malformed(path, `Expected one of: ${allowed.join(', ')}.`));
  }
  return ok(value as T[number]);
}

function parseIntegerArray(value: unknown, path: string): Parsed<readonly number[]> {
  if (!Array.isArray(value)) {
    return err(malformed(path, 'Expected an array.'));
  }
  const result: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const entry = parseNonNegativeInteger(value[index], `${path}[${index}]`);
    if (!entry.ok) return entry;
    result.push(entry.value);
  }
  if (new Set(result).size !== result.length) {
    return err(malformed(path, 'Contains the same entry more than once.'));
  }
  return ok(result);
}

function parseTradeSide(value: unknown, path: string): Parsed<TradeSide> {
  if (!isRecord(value)) {
    return err(malformed(path, 'Expected an object.'));
  }
  const cash = parseNonNegativeInteger(value['cash'], `${path}.cash`);
  if (!cash.ok) return cash;
  const deedIds = parseIntegerArray(value['deedIds'], `${path}.deedIds`);
  if (!deedIds.ok) return deedIds;
  const jailCards = parseNonNegativeInteger(value['jailCards'], `${path}.jailCards`);
  if (!jailCards.ok) return jailCards;

  return ok({ cash: cash.value, deedIds: deedIds.value, jailCards: jailCards.value });
}

/** Actions that carry nothing but their type. */
const bareActionTypes = [
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
] as const;

/** Actions whose only payload is the square they act on. */
const squareActionTypes = ['BUILD_HOUSE', 'SELL_HOUSE', 'MORTGAGE', 'UNMORTGAGE'] as const;

export function parseAction(input: unknown): Result<Action, MalformedAction> {
  if (!isRecord(input)) {
    return err(malformed('action', 'Expected an object.'));
  }

  const type = input['type'];
  if (typeof type !== 'string') {
    return err(malformed('action.type', 'Expected a string.'));
  }

  for (const bare of bareActionTypes) {
    if (type === bare) return ok({ type: bare });
  }

  for (const withSquare of squareActionTypes) {
    if (type === withSquare) {
      const squareId = parseNonNegativeInteger(input['squareId'], 'action.squareId');
      if (!squareId.ok) return squareId;
      return ok({ type: withSquare, squareId: squareId.value });
    }
  }

  if (type === 'PLACE_BID') {
    const amount = parseNonNegativeInteger(input['amount'], 'action.amount');
    if (!amount.ok) return amount;
    return ok({ type: 'PLACE_BID', amount: amount.value });
  }

  if (type === 'OFFER_TRADE') {
    const toId = parseString(input['toId'], 'action.toId');
    if (!toId.ok) return toId;
    const offered = parseTradeSide(input['offered'], 'action.offered');
    if (!offered.ok) return offered;
    const requested = parseTradeSide(input['requested'], 'action.requested');
    if (!requested.ok) return requested;
    return ok({
      type: 'OFFER_TRADE',
      toId: toId.value,
      offered: offered.value,
      requested: requested.value,
    });
  }

  return err(malformed('action.type', `Unknown action: ${type}.`));
}

/**
 * The rule configuration chosen at creation.
 *
 * Lives here rather than in the web app because the permitted values are game
 * rules (→ PRD F15), and a second copy of them in a request schema would drift
 * from the engine that has to honour them.
 */
export function parseGameConfig(input: unknown): Result<GameConfig, MalformedAction> {
  const source = input === undefined ? {} : input;
  if (!isRecord(source)) {
    return err(malformed('config', 'Expected an object.'));
  }

  const known = [
    'startingCash',
    'salary',
    'freeParkingPot',
    'incomeTaxMode',
    'auctionOnDecline',
    'auctionSeconds',
  ];
  for (const key of Object.keys(source)) {
    if (!known.includes(key)) {
      return err(malformed(`config.${key}`, `Unknown setting: ${key}.`));
    }
  }

  const startingCash = parseOneOf(source['startingCash'] ?? 1500, 'config.startingCash', [
    1000, 1500, 2000,
  ] as const);
  if (!startingCash.ok) return startingCash;

  const salary = parseOneOf(source['salary'] ?? 200, 'config.salary', [200, 400] as const);
  if (!salary.ok) return salary;

  const freeParkingPot = parseBoolean(source['freeParkingPot'] ?? false, 'config.freeParkingPot');
  if (!freeParkingPot.ok) return freeParkingPot;

  const incomeTaxMode = parseOneOf(source['incomeTaxMode'] ?? 'flat', 'config.incomeTaxMode', [
    'flat',
    'percentage',
  ] as const);
  if (!incomeTaxMode.ok) return incomeTaxMode;

  const auctionOnDecline = parseBoolean(
    source['auctionOnDecline'] ?? true,
    'config.auctionOnDecline',
  );
  if (!auctionOnDecline.ok) return auctionOnDecline;

  const auctionSeconds = parseInteger(source['auctionSeconds'] ?? 30, 'config.auctionSeconds');
  if (!auctionSeconds.ok) return auctionSeconds;
  if (auctionSeconds.value < 15 || auctionSeconds.value > 120) {
    return err(malformed('config.auctionSeconds', 'Expected between 15 and 120 seconds.'));
  }

  return ok({
    startingCash: startingCash.value,
    salary: salary.value,
    freeParkingPot: freeParkingPot.value,
    incomeTaxMode: incomeTaxMode.value,
    auctionOnDecline: auctionOnDecline.value,
    auctionSeconds: auctionSeconds.value,
  });
}
