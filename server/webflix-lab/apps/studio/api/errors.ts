/**
 * WebFlix-Lab Operator Studio (WFLX-UI1) — HTTP response helpers.
 *
 * Thin boundary utilities only: typed JSON responses and the studio's typed
 * error body shape. No domain logic lives here.
 */

import type { ApiErrorBody } from './types';

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

/** Typed error surface: every API failure carries `error` + `message`. */
export function errorResponse(
  status: number,
  error: string,
  message: string,
  extra: Record<string, unknown> = {},
): Response {
  const body: ApiErrorBody = { error, message, ...extra };
  return jsonResponse(status, body);
}

export function notFoundResponse(pathname: string): Response {
  return errorResponse(404, 'not-found', `no route for '${pathname}'`);
}

export function methodNotAllowedResponse(allowed: readonly string[]): Response {
  return new Response(
    JSON.stringify({
      error: 'method-not-allowed',
      message: `allowed: ${allowed.join(', ')}`,
    } satisfies ApiErrorBody),
    {
      status: 405,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        allow: allowed.join(', '),
        'cache-control': 'no-store',
      },
    },
  );
}
