/**
 * WebFlix-Lab Operator Studio (WFLX-UI1) — GET /api/sources.
 *
 * Enumerates the checked-in fixtures usable as REAL pipeline sources. Each
 * entry is ingested through the actual MarkdownNoteAdapter so the fingerprint
 * is exactly what the repo computes (parity with the checked-in
 * fixtures/contracts/*.source-artifact.json is enforced by the repo's own
 * tests). The surface is labeled honestly as the WebFlix-Lab research
 * implementation — never the Gemini Notebook product.
 */

import { listStudioSources } from '../pipeline';
import { jsonResponse } from './errors';

export async function handleSources(): Promise<Response> {
  const body = await listStudioSources();
  return jsonResponse(200, body);
}
