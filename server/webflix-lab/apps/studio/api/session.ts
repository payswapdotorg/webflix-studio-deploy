/**
 * WebFlix-Lab Operator Studio (WFLX-UI2) — the Interactive Audio session
 * routes (replacing the W1 501 stubs, per the handoff contract).
 *
 *   POST /api/session                {overviewId} -> session established
 *   POST /api/session/:id/intervene  {afterTurnIndex, listenerText}
 *   GET  /api/session/:id            current session state (fork history)
 *
 * Handlers stay THIN: parsing + typed error mapping only. All session logic
 * lives in apps/studio/sessions.ts, which drives the REAL machinery
 * (InteractiveAudioSession.intervene — never re-implemented).
 *
 * Typed error surface:
 *   400 invalid-body        malformed JSON / missing or non-string overviewId
 *   404 unknown-overview    overviewId not in the in-memory store
 *   404 unknown-session     sessionId not in the in-memory registry
 *   400 invalid-boundary    afterTurnIndex not an interior turn boundary
 *   400 empty-listener-text listenerText not a non-empty string
 *   500 intervene-failed    the machinery threw (stage: interactive-session)
 */

import {
  establishSession,
  interveneOnSession,
  sessionStateOf,
} from '../sessions';
import { StudioValidationError, type StudioContext } from '../pipeline';
import { errorResponse, jsonResponse } from './errors';

/** StudioValidationError code -> HTTP status (the typed error surface). */
function sessionErrorStatus(code: string): number {
  if (code === 'unknown-overview' || code === 'unknown-session') return 404;
  return 400;
}

function sessionErrorResponse(error: unknown): Response | null {
  if (!(error instanceof StudioValidationError)) return null;
  return errorResponse(sessionErrorStatus(error.code), error.code, error.message, {
    details: error.details,
  });
}

async function parseJsonObject(req: Request): Promise<Record<string, unknown> | null> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}

export async function handleSessionCreate(ctx: StudioContext, req: Request): Promise<Response> {
  const body = await parseJsonObject(req);
  if (body === null) {
    return errorResponse(400, 'invalid-body', 'request body must be a JSON object');
  }
  const overviewId = body['overviewId'];
  if (typeof overviewId !== 'string' || overviewId.length === 0) {
    return errorResponse(400, 'invalid-body', 'overviewId must be a non-empty string (the compiled baseline artifact id)');
  }
  try {
    return jsonResponse(200, establishSession(ctx, overviewId));
  } catch (error) {
    const typed = sessionErrorResponse(error);
    if (typed !== null) return typed;
    throw error;
  }
}

export async function handleSessionIntervene(
  ctx: StudioContext,
  req: Request,
  sessionId: string,
): Promise<Response> {
  const body = await parseJsonObject(req);
  if (body === null) {
    return errorResponse(400, 'invalid-body', 'request body must be a JSON object');
  }
  try {
    const response = await interveneOnSession(
      ctx,
      sessionId,
      body['afterTurnIndex'],
      body['listenerText'],
    );
    return jsonResponse(200, response);
  } catch (error) {
    const typed = sessionErrorResponse(error);
    if (typed !== null) return typed;
    // The machinery threw — typed 500 with the failing stage named.
    const message = error instanceof Error ? error.message : String(error);
    return errorResponse(500, 'intervene-failed', message, { stage: 'interactive-session' });
  }
}

export function handleSessionState(ctx: StudioContext, sessionId: string): Response {
  try {
    return jsonResponse(200, sessionStateOf(ctx, sessionId));
  } catch (error) {
    const typed = sessionErrorResponse(error);
    if (typed !== null) return typed;
    throw error;
  }
}
