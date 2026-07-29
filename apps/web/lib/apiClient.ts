import type { Action, GameEvent, LegalAction, PublicGameState } from '@parkway/engine';

/**
 * Typed access to the API, and the one place a failed request becomes something
 * the UI can act on.
 *
 * Every call returns a discriminated result rather than throwing. A 409 and a
 * 422 are ordinary answers here — one means the world moved, the other means the
 * rules said no — and code that has to handle both is clearer when neither
 * arrives as an exception.
 */

export type PlayerSummary = {
  readonly id: string;
  readonly name: string;
  readonly seat: number;
  readonly colour: string;
  readonly isConnected: boolean;
};

export type GamePayload = {
  readonly gameId: string;
  readonly roomCode: string;
  readonly status: 'lobby' | 'active' | 'finished' | 'abandoned';
  readonly seq: number;
  readonly players: readonly PlayerSummary[];
  readonly publicState: PublicGameState | null;
  readonly legalActions: readonly LegalAction[];
  readonly you: { readonly playerId: string; readonly isHost: boolean };
};

export type ApiFailure = {
  readonly status: number;
  readonly code: string;
  readonly message: string;
  /** Present on a 409, so the caller knows what the sequence actually is. */
  readonly seq?: number;
};

export type ApiResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly failure: ApiFailure };

const networkFailure: ApiFailure = {
  status: 0,
  code: 'NETWORK',
  message: 'Could not reach the server. Check your connection.',
};

async function request<T>(
  path: string,
  init: RequestInit & { token?: string } = {},
): Promise<ApiResult<T>> {
  const { token, ...rest } = init;

  let response: Response;
  try {
    response = await fetch(path, {
      ...rest,
      headers: {
        'content-type': 'application/json',
        ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
        ...rest.headers,
      },
    });
  } catch {
    return { ok: false, failure: networkFailure };
  }

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const error =
      typeof body === 'object' && body !== null && 'error' in body
        ? (body as { error: { code: string; message: string } }).error
        : { code: 'SERVER_ERROR', message: 'Something went wrong.' };

    const seq =
      typeof body === 'object' && body !== null && 'seq' in body
        ? (body as { seq: number }).seq
        : undefined;

    return {
      ok: false,
      failure: {
        status: response.status,
        code: error.code,
        message: error.message,
        ...(seq === undefined ? {} : { seq }),
      },
    };
  }

  return { ok: true, value: body as T };
}

export type CreateResponse = {
  readonly gameId: string;
  readonly roomCode: string;
  readonly playerId: string;
  readonly playerToken: string;
  readonly game: GamePayload;
};

export function createGameRequest(
  name: string,
  config?: Record<string, unknown>,
): Promise<ApiResult<CreateResponse>> {
  return request('/api/games', {
    method: 'POST',
    body: JSON.stringify(config === undefined ? { name } : { name, config }),
  });
}

export type JoinResponse = {
  readonly gameId: string;
  readonly roomCode: string;
  readonly playerId: string;
  /** Absent when the request reconnected an existing seat rather than taking one. */
  readonly playerToken?: string;
  readonly game: GamePayload;
};

export function joinGameRequest(
  roomCode: string,
  name: string,
  token?: string,
): Promise<ApiResult<JoinResponse>> {
  return request('/api/games/join', {
    method: 'POST',
    body: JSON.stringify({ roomCode, name }),
    ...(token === undefined ? {} : { token }),
  });
}

export function fetchGame(gameId: string, token: string): Promise<ApiResult<GamePayload>> {
  return request(`/api/games/${gameId}`, { token, cache: 'no-store' });
}

export type ActionResponse = {
  readonly seq: number;
  readonly events: readonly GameEvent[];
  readonly game: GamePayload;
};

export function postAction(
  gameId: string,
  token: string,
  expectedSeq: number,
  action: Action,
): Promise<ApiResult<ActionResponse>> {
  return request(`/api/games/${gameId}/actions`, {
    method: 'POST',
    token,
    body: JSON.stringify({ expectedSeq, action }),
  });
}

export type LogEntry = {
  readonly seq: number;
  readonly playerId: string | null;
  readonly events: readonly GameEvent[];
  readonly createdAt: string;
};

export function fetchLog(
  gameId: string,
  token: string,
  since: number,
): Promise<ApiResult<{ entries: readonly LogEntry[]; hasMore: boolean }>> {
  return request(`/api/games/${gameId}/log?since=${since}`, { token, cache: 'no-store' });
}
