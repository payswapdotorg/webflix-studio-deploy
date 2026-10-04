/**
 * Pre-bakes the deterministic baseline master WAV into
 * public/audio/<artifactId>/master.wav.
 *
 * Runs the REAL studio pipeline (the vendored, patched
 * apps/studio/pipeline.ts — the frozen machinery with its fixed seeds) in
 * process, using exactly the request the studio web client issues for the
 * default journey (source-messy-note-redacted / deep-dive / 300 s). The
 * compile is byte-deterministic, so the baked WAV is byte-identical to what
 * the local :4313 studio serves for the same request (the determinism
 * spine; asserted cross-boot in the source repo's test battery).
 *
 * Runs under bun (prepare-time only).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const here = import.meta.dir;
const pipeline = await import(join(here, '..', 'server', 'webflix-lab', 'apps', 'studio', 'pipeline.ts'));

const ctx = pipeline.createStudioContext(process.env);
const request = {
  sourceId: 'source-messy-note-redacted',
  mode: 'deep-dive' as const,
  durationSeconds: 300,
};
const overview = await pipeline.compileStudioOverview(ctx, request);
const stored = ctx.store.get(overview.artifactId);
if (stored === undefined) {
  throw new Error(`compile did not store artifact ${overview.artifactId}`);
}

const outDir = join(here, '..', 'public', 'audio', overview.artifactId);
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, 'master.wav');
writeFileSync(outPath, stored.wav);

console.log(
  `baked baseline: artifactId=${overview.artifactId} turns=${overview.plan.turnCount} ` +
    `bytes=${stored.wav.byteLength} -> ${outPath}`,
);
