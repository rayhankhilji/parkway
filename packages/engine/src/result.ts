/**
 * The engine's error convention.
 *
 * Rules do not throw. A rule violation is the expected outcome of an untrusted
 * client asking for something the rules forbid, so it is a value the caller must
 * handle, not an exception it may ignore. Throwing is reserved for infrastructure
 * failures, which the engine has none of.
 *
 * The error type is a parameter rather than a fixed union because parse failures
 * and rule violations are deliberately different types (see D14, D15): one means a
 * broken client, the other a disallowed move, and the API maps them to different
 * status codes.
 */

export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err<E> = { readonly ok: false; readonly error: E };
export type Result<T, E> = Ok<T> | Err<E>;

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.ok;
}

export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return !result.ok;
}

/**
 * Unwraps a result, throwing if it is an error.
 *
 * This exists for tests and for the handful of call sites that have already
 * established the result is Ok. It is deliberately noisy to type so that it never
 * becomes the default way to read a Result in engine code — production paths
 * narrow with `isOk`/`isErr` and handle both branches.
 */
export function expectOk<T, E>(result: Result<T, E>, message: string): T {
  if (!result.ok) {
    throw new Error(`${message}: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}
