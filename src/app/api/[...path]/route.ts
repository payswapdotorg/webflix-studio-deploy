/**
 * WebFlix-Lab Operator Studio — the Vercel/Next.js deployment adapter.
 *
 * This is the deployment layer ONLY (see server/webflix-lab/COMPAT_PATCHES.md):
 * a single catch-all route that delegates every request to the unmodified
 * studio router `handleStudioRequest(ctx, req)` — the same fetch-API entry
 * the local `bun run apps/studio/server.ts` serves on :4313. Zero business
 * logic lives here.
 *
 * Routing map (next.config.ts rewrites fill the gaps):
 *   /                    -> public/index.html   (the zero-build studio client)
 *   /app.js, /styles.css -> public/*           (byte-parity copies)
 *   /api/**              -> this route          (studio router, as-is)
 *   /audio/:id/master.wav
 *                        -> public/audio/<id>/master.wav when pre-baked
 *                           (the deterministic baseline), else rewritten to
 *                           /api/audio/... and served by this route (fresh
 *                           compiles + session masters, in-memory store)
 */

import { createStudioContext, type StudioContext } from '@vendor/apps/studio/pipeline';
import { handleStudioRequest } from '@vendor/apps/studio/api/router';

/** The per-instance studio context (in-memory stores; restart resets them). */
const ctx: StudioContext = createStudioContext(process.env);

/**
 * Vercel/Next rewrites /audio/:id/master.wav to /api/audio/:id/master.wav so
 * it lands in this catch-all; the studio router matches pathnames exactly, so
 * the public URL shape is restored here.
 */
function studioRequest(req: Request): Request {
  const url = new URL(req.url);
  if (url.pathname.startsWith('/api/audio/')) {
    url.pathname = url.pathname.slice('/api'.length);
    return new Request(url.toString(), req);
  }
  return req;
}

/**
 * Serverless function responses have a buffered-body cap (~4.5 MB); the
 * multi-MB master WAVs (baseline ~27 MB, session masters ~32 MB) must stream
 * instead. Transport-only concern: the bytes are unchanged.
 */
const STREAM_THRESHOLD_BYTES = 4_000_000;

function passthrough(res: Response): Response {
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.startsWith('audio/wav') && res.body !== null) {
    const length = Number(res.headers.get('content-length') ?? '0');
    if (length > STREAM_THRESHOLD_BYTES || length === 0) {
      return new Response(res.body, res);
    }
  }
  return res;
}

async function dispatch(req: Request): Promise<Response> {
  const res = await handleStudioRequest(ctx, studioRequest(req));
  return passthrough(res);
}

export async function GET(req: Request): Promise<Response> {
  return dispatch(req);
}
export async function POST(req: Request): Promise<Response> {
  return dispatch(req);
}
export async function PUT(req: Request): Promise<Response> {
  return dispatch(req);
}
export async function PATCH(req: Request): Promise<Response> {
  return dispatch(req);
}
export async function DELETE(req: Request): Promise<Response> {
  return dispatch(req);
}
export async function HEAD(req: Request): Promise<Response> {
  return dispatch(req);
}
export async function OPTIONS(req: Request): Promise<Response> {
  return dispatch(req);
}

// The studio surface is per-instance and explicitly no-store; never cache.
export const dynamic = 'force-dynamic';
// The Deep-Dive 300 s compile takes ~4-5 s of CPU locally; leave headroom for
// cold starts and slower serverless CPUs.
export const maxDuration = 60;
export const runtime = 'nodejs';
