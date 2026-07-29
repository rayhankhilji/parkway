/**
 * Rule violations — the expected outcome of a client asking for something the
 * rules forbid. They are returned, never thrown, and the API maps them to 422
 * with the code intact so the UI can explain the refusal next to the control that
 * caused it.
 *
 * Messages are written for a player to read. They say what was refused and why,
 * and they never mention state fields, function names or codes.
 */

export type RuleViolationCode =
  // Starting
  | 'NOT_ENOUGH_PLAYERS'
  | 'TOO_MANY_PLAYERS'
  // Turn flow
  | 'NOT_YOUR_TURN'
  | 'WRONG_PHASE'
  | 'PLAYER_NOT_IN_GAME'
  | 'PLAYER_BANKRUPT'
  | 'GAME_OVER'
  // Money
  | 'INSUFFICIENT_FUNDS'
  // Ownership
  | 'SQUARE_NOT_OWNABLE'
  | 'SQUARE_ALREADY_OWNED'
  | 'SQUARE_NOT_OWNED'
  | 'NOT_THE_OWNER'
  // Building
  | 'INCOMPLETE_GROUP'
  | 'GROUP_HAS_MORTGAGE'
  | 'UNEVEN_BUILD'
  | 'UNEVEN_SELL'
  | 'MAX_DEVELOPMENT'
  | 'NO_BUILDINGS_TO_SELL'
  | 'BANK_OUT_OF_HOUSES'
  | 'BANK_OUT_OF_HOTELS'
  // Mortgaging
  | 'PROPERTY_HAS_BUILDINGS'
  | 'PROPERTY_MORTGAGED'
  | 'PROPERTY_NOT_MORTGAGED'
  // Auctions
  | 'AUCTION_IN_PROGRESS'
  | 'NOT_IN_AUCTION'
  | 'ALREADY_PASSED'
  | 'BID_BELOW_MINIMUM'
  | 'BID_ABOVE_CASH'
  | 'DEADLINE_NOT_REACHED'
  // Jail
  | 'NOT_IN_JAIL'
  | 'NO_JAIL_CARD'
  // Debt
  | 'DEBT_OUTSTANDING'
  | 'NO_DEBT'
  | 'DEBT_NOT_SETTLED'
  // Trading
  | 'TRADE_ALREADY_OPEN'
  | 'NO_OPEN_TRADE'
  | 'NOT_TRADE_RECIPIENT'
  | 'SELF_TRADE'
  | 'INVALID_TRADE';

export type RuleViolation = {
  readonly code: RuleViolationCode;
  readonly message: string;
};

export function violation(code: RuleViolationCode, message: string): RuleViolation {
  return { code, message };
}

/**
 * A structurally invalid action. Distinct from a rule violation because it means
 * a broken client rather than a disallowed move, and the API answers it with 400
 * rather than 422 (→ D15).
 */
export type MalformedAction = {
  readonly code: 'MALFORMED_ACTION';
  readonly message: string;
  /** Where in the action the problem is, e.g. `action.offered.cash`. */
  readonly path: string;
};

export function malformed(path: string, message: string): MalformedAction {
  return { code: 'MALFORMED_ACTION', message, path };
}
