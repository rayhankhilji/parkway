/**
 * The engine's only source of randomness.
 *
 * mulberry32 is a 32-bit state, 32-bit output generator. It is chosen not for
 * statistical excellence — a board game needs fair dice, not cryptography — but
 * because its entire state is one integer. That means the state serialises into
 * the game document as a single number, survives a JSON round trip exactly, and
 * produces the same sequence on every machine and every runtime forever.
 *
 * Every function here takes a state and returns the next one. Nothing mutates,
 * so a caller that forgets to thread the new state through gets a repeated value
 * rather than silent divergence between the live game and its replay.
 */

export type RngState = { readonly seed: number };

export function createRng(seed: number): RngState {
  // Coerced to an unsigned 32-bit integer so that a caller passing a float, a
  // negative, or a value above 2^32 cannot produce a state that behaves
  // differently after a JSON round trip.
  return { seed: seed >>> 0 };
}

/** Advances the generator, returning a uniform 32-bit unsigned integer. */
export function nextUint32(state: RngState): readonly [number, RngState] {
  const seed = (state.seed + 0x6d2b79f5) | 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = (t ^ (t >>> 14)) >>> 0;
  return [value, { seed: seed >>> 0 }];
}

/**
 * A uniform integer in [0, boundExclusive).
 *
 * Uses rejection sampling rather than a plain modulo. Modulo would bias the low
 * values by about one part in 700 million, which is invisible in play but would
 * make the fuzz suite's distribution assertions subtly wrong, and "the dice are
 * slightly loaded" is not a sentence this project should ever have to write.
 */
export function nextInt(state: RngState, boundExclusive: number): readonly [number, RngState] {
  if (!Number.isInteger(boundExclusive) || boundExclusive <= 0) {
    throw new Error(`nextInt bound must be a positive integer, received ${boundExclusive}`);
  }

  const limit = 0x100000000 - (0x100000000 % boundExclusive);
  let current = state;
  for (;;) {
    const [value, next] = nextUint32(current);
    current = next;
    if (value < limit) {
      return [value % boundExclusive, current];
    }
  }
}

/** A single die, 1 through faces inclusive. */
export function rollDie(state: RngState, faces: number): readonly [number, RngState] {
  const [value, next] = nextInt(state, faces);
  return [value + 1, next];
}

/**
 * Fisher–Yates, returning a new array.
 *
 * Walking downward from the end is the unbiased form; the common upward variant
 * that picks from the whole array each step is not, and this shuffle decides both
 * turn order and deck order for the entire game.
 */
export function shuffle<T>(
  items: readonly T[],
  state: RngState,
): readonly [readonly T[], RngState] {
  const result = [...items];
  let current = state;

  for (let i = result.length - 1; i > 0; i -= 1) {
    const [j, next] = nextInt(current, i + 1);
    current = next;
    const a = result[i];
    const b = result[j];
    if (a === undefined || b === undefined) {
      throw new Error(`shuffle index out of range: ${i}, ${j}`);
    }
    result[i] = b;
    result[j] = a;
  }

  return [result, current];
}
