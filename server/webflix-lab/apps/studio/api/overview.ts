/**
 * WebFlix-Lab Operator Studio (WFLX-UI1) — POST /api/overview.
 *
 * Compile an Audio Overview through the REAL pipeline (see
 * apps/studio/pipeline.ts — adapter -> understanding -> Director -> audio
 * compile; zero domain duplication in this layer). Failures surface as typed
 * error bodies: request-shape problems as 4xx, pipeline failures as 500
 * `compile-failed` with the failing stage named.
 */

import { AudioCompilerError } from '../../../src/audio';
import { DirectorError } from '../../../src/director/compiler';
import { AdapterError } from '../../../src/source/adapter';
import { CredentialShapeError } from '../../../src/source/normalize';
import {
  compileStudioOverview,
  validateOverviewRequest,
  StudioValidationError,
  type StudioContext,
} from '../pipeline';
import { errorResponse, jsonResponse } from './errors';
import type { ValidOverviewRequest } from './types';

interface ParsedBody {
  sourceId: unknown;
  mode: unknown;
  durationSeconds: unknown;
}

function parseBody(raw: unknown): ParsedBody {
  if (typeof raw !== 'object' || raw === null) {
    throw new StudioValidationError('invalid-body', 'request body must be a JSON object');
  }
  const record = raw as Record<string, unknown>;
  return {
    sourceId: record['sourceId'],
    mode: record['mode'],
    durationSeconds: record['durationSeconds'],
  };
}

/** Map a pipeline failure to the failing stage name (honest reporting). */
function stageOf(error: unknown): string {
  if (error instanceof DirectorError) return 'director';
  if (error instanceof AudioCompilerError) return 'audio-compiler';
  if (error instanceof CredentialShapeError) return 'source-adapter (credential-shape guard)';
  if (error instanceof AdapterError) return 'source-adapter';
  return 'pipeline';
}

export async function handleOverview(ctx: StudioContext, req: Request): Promise<Response> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return errorResponse(400, 'invalid-body', 'request body must be valid JSON');
  }

  let request: ValidOverviewRequest;
  try {
    request = validateOverviewRequest(parseBody(raw));
  } catch (error) {
    if (error instanceof StudioValidationError) {
      return errorResponse(400, error.code, error.message, { details: error.details });
    }
    throw error;
  }

  try {
    const overview = await compileStudioOverview(ctx, request);
    return jsonResponse(200, overview);
  } catch (error) {
    if (error instanceof StudioValidationError) {
      return errorResponse(400, error.code, error.message, { details: error.details });
    }
    const message = error instanceof Error ? error.message : String(error);
    return errorResponse(500, 'compile-failed', message, { stage: stageOf(error) });
  }
}
