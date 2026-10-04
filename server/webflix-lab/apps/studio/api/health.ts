/**
 * WebFlix-Lab Operator Studio (WFLX-UI1) — GET /api/health.
 *
 * {ok, version, provider}: the provider block reports the ACTIVE provider id
 * honestly (the offline deterministic adapter the studio pins) plus the
 * env-gated live providers' STATE only — they are never switchable from the
 * UI (WFLX-UI1 non-goal: no live-provider activation).
 */

import { providerStateFor, type StudioContext } from '../pipeline';
import { jsonResponse } from './errors';
import { STUDIO_VERSION, type HealthResponse } from './types';

export function handleHealth(ctx: StudioContext): Response {
  const body: HealthResponse = {
    ok: true,
    version: STUDIO_VERSION,
    provider: providerStateFor(ctx.env),
  };
  return jsonResponse(200, body);
}
