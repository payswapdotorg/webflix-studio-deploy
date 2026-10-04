/**
 * WebFlix-Lab Operator Studio (WFLX-UI1 + WFLX-UI2) — request router.
 *
 * One dispatch table for the whole surface:
 *
 *   GET  /                            static client (web/index.html)
 *   GET  /app.js                      type-stripped web/app.ts (zero build)
 *   GET  /styles.css                  stylesheet
 *   GET  /api/health                  {ok, version, provider}
 *   GET  /api/sources                 checked-in pipeline sources
 *   POST /api/overview                compile through the real pipeline
 *   POST /api/session                 join an Interactive Audio session (W2)
 *   POST /api/session/:id/intervene   typed listener question at a boundary (W2)
 *   GET  /api/session/:id             session state + fork history (W2)
 *   GET  /audio/:id/master.wav        compiled master WAV (overview OR session master)
 *
 * Handlers stay thin (see api/*); all pipeline calls go through
 * apps/studio/pipeline.ts, and all session calls through
 * apps/studio/sessions.ts — both import the EXISTING machinery.
 */

import { handleAudio } from './audio';
import { errorResponse, methodNotAllowedResponse, notFoundResponse } from './errors';
import { handleHealth } from './health';
import { handleOverview } from './overview';
import { handleSessionCreate, handleSessionIntervene, handleSessionState } from './session';
import { handleSources } from './sources';
import { handleAppJs, handleIndex, handleStyles } from './static';
import type { StudioContext } from '../pipeline';

const SESSION_INTERVENE_ROUTE = /^\/api\/session\/([^/]+)\/intervene$/;
const SESSION_STATE_ROUTE = /^\/api\/session\/([^/]+)$/;

type Handler = (ctx: StudioContext, req: Request, params: string[]) => Response | Promise<Response>;

interface Route {
  readonly method: string;
  readonly pattern: RegExp | string;
  readonly handler: Handler;
}

const ROUTES: readonly Route[] = [
  { method: 'GET', pattern: '/', handler: () => handleIndex() },
  { method: 'GET', pattern: '/app.js', handler: () => handleAppJs() },
  { method: 'GET', pattern: '/styles.css', handler: () => handleStyles() },
  { method: 'GET', pattern: '/api/health', handler: (ctx) => handleHealth(ctx) },
  { method: 'GET', pattern: '/api/sources', handler: () => handleSources() },
  { method: 'POST', pattern: '/api/overview', handler: (ctx, req) => handleOverview(ctx, req) },
  { method: 'POST', pattern: '/api/session', handler: (ctx, req) => handleSessionCreate(ctx, req) },
  {
    method: 'POST',
    pattern: SESSION_INTERVENE_ROUTE,
    handler: (ctx, req, params) => handleSessionIntervene(ctx, req, params[0] ?? ''),
  },
  {
    method: 'GET',
    pattern: SESSION_STATE_ROUTE,
    handler: (ctx, _req, params) => handleSessionState(ctx, params[0] ?? ''),
  },
  {
    method: 'GET',
    pattern: /^\/audio\/([A-Za-z0-9_-]+)\/master\.wav$/,
    handler: (ctx, req, params) => handleAudio(ctx, params[0] ?? '', req),
  },
];

function matches(route: Route, method: string, pathname: string): string[] | null {
  if (route.method !== method) return null;
  if (typeof route.pattern === 'string') {
    return route.pattern === pathname ? [] : null;
  }
  const match = route.pattern.exec(pathname);
  if (match === null) return null;
  return match.slice(1);
}

export async function handleStudioRequest(ctx: StudioContext, req: Request): Promise<Response> {
  const { pathname } = new URL(req.url);
  const method = req.method.toUpperCase();

  for (const route of ROUTES) {
    const params = matches(route, method, pathname);
    if (params !== null) {
      return route.handler(ctx, req, params);
    }
  }

  // Known path, wrong method -> 405 with the allowed set.
  const pathRoutes = ROUTES.filter(
    (route) => route.method !== method && matches(route, route.method, pathname) !== null,
  );
  if (pathRoutes.length > 0) {
    return methodNotAllowedResponse(pathRoutes.map((route) => route.method));
  }

  if (pathname === '/favicon.ico') {
    return new Response('', { status: 204 });
  }
  if (pathname.startsWith('/api/')) {
    return notFoundResponse(pathname);
  }
  return errorResponse(404, 'not-found', `no route for '${pathname}'`);
}
