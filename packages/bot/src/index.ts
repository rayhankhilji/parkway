/**
 * @parkway/bot — a computer opponent.
 *
 * It depends on the engine and the engine knows nothing about it. That direction
 * matters: the engine answers what is *legal*, this package answers what is
 * *good*, and keeping them apart is what stops strategy leaking into the rules.
 *
 * A bot is a client. It sees a PublicGameState and a list of legal actions —
 * exactly what a human sees — and returns one of them. No bot can consult the
 * deck order or the generator, because neither is in what it is given.
 */

export { landingOdds, landingOddsFor, type LandingOdds } from './landing';

export {
  acquisitionValue,
  boardOf,
  buildReturn,
  holdings,
  incomePerOpponentTurn,
  liquidity,
  ownableAt,
  profiles,
  rentIfOwnedBy,
  worstExposure,
  type Difficulty,
  type Profile,
} from './valuation';

export { createBot, botHoldings, type Bot, type BotView } from './policy';
