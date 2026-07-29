import 'server-only';
import { NextResponse } from 'next/server';

/**
 * The error shape, in one place.
 *
 * Every failure the API returns looks the same: a machine-readable code and a
 * sentence safe to put in front of a player. No stack traces, no SQL, no engine
 * internals — a person who has just been told they cannot do something deserves
 * to know why, and nobody deserves to be shown a query.
 */

export type ApiError = { readonly error: { readonly code: string; readonly message: string } };

export function fail(
  status: number,
  code: string,
  message: string,
  extra?: Record<string, unknown>,
) {
  return NextResponse.json({ error: { code, message }, ...extra }, { status });
}

export const unauthorised = () =>
  fail(401, 'UNAUTHORISED', 'You are not signed in to this game on this device.');

export const forbidden = () => fail(403, 'WRONG_GAME', 'That seat belongs to a different game.');

export const notFound = (what = 'game') => fail(404, 'NOT_FOUND', `That ${what} does not exist.`);

/**
 * An unexpected failure. The detail is logged for whoever is on call and never
 * sent to the client, because it is of no use to a player and of some use to
 * someone probing the service.
 */
export function serverError(context: string, error: unknown) {
  console.error(`${context}:`, error);
  return fail(500, 'SERVER_ERROR', 'Something went wrong at our end. Please try again.');
}

/**
 * Wraps a handler so that a thrown infrastructure failure becomes a 500 rather
 * than an unhandled rejection. Rule violations never reach here — they are
 * returned as values and mapped to 422 by the route itself.
 */
export async function handle(context: string, run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    return serverError(context, error);
  }
}
