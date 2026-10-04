/**
 * WebFlix-Lab shared IR — JSON Schema emission.
 *
 * Emits one self-contained draft-2020-12 JSON Schema file per contract into
 * src/contracts/schemas/ for cross-worker interop (workers and external
 * tooling can validate JSON payloads without TypeScript).
 *
 * Cross-field invariants that JSON Schema cannot express (mode/modality
 * correlation, end > start, graph referential integrity, media spec
 * presence, duration/weight budgets, coverage accounting) are enforced by
 * the zod guards and validation.ts; each schema description states this.
 *
 * Run: bun run contracts:emit
 * The committed files must stay byte-identical to the emission
 * (tests/contracts/schemas.test.ts enforces this).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { AudioTurnSchema } from './audio-turn';
import { ClaimRecordSchema } from './claim';
import { EntityRecordSchema } from './entity';
import { ExperimentRecordSchema } from './experiment-record';
import { GeneratedArtifactSchema } from './generated-artifact';
import { OverviewPlanSchema } from './overview-plan';
import { RelationshipRecordSchema } from './relationship';
import { SemanticGraphSchema } from './semantic-graph';
import { SourceArtifactSchema } from './source-artifact';
import { TopicRecordSchema } from './topic';
import { VideoSceneSchema } from './video-scene';

export const SCHEMA_BASE_ID = 'https://webflix-lab.dev/contracts';

const TARGETS = [
  ['source-artifact', SourceArtifactSchema],
  ['claim', ClaimRecordSchema],
  ['entity', EntityRecordSchema],
  ['topic', TopicRecordSchema],
  ['relationship', RelationshipRecordSchema],
  ['semantic-graph', SemanticGraphSchema],
  ['overview-plan', OverviewPlanSchema],
  ['audio-turn', AudioTurnSchema],
  ['video-scene', VideoSceneSchema],
  ['generated-artifact', GeneratedArtifactSchema],
  ['experiment-record', ExperimentRecordSchema],
] as const;

export type SchemaName = (typeof TARGETS)[number][0];

type JsonRecord = Record<string, unknown>;

/**
 * Convert one zod schema to a root JSON Schema with $id set.
 * zod wraps meta-id'd schemas as { $ref, $defs }; unwrap to a clean root.
 */
function toRootSchema(name: string, schema: z.ZodType): JsonRecord {
  const emitted = z.toJSONSchema(schema, { target: 'draft-2020-12' }) as JsonRecord;
  let root = emitted;
  if (
    typeof emitted.$ref === 'string' &&
    emitted.$ref.startsWith('#/$defs/') &&
    emitted.$defs !== undefined
  ) {
    const key = decodeURIComponent(emitted.$ref.slice('#/$defs/'.length));
    const defs = emitted.$defs as JsonRecord;
    const def = defs[key] as JsonRecord | undefined;
    if (def === undefined) {
      throw new Error(`emission for ${name} references missing def ${key}`);
    }
    const rest = { ...defs };
    delete rest[key];
    root = { ...def, ...(Object.keys(rest).length > 0 ? { $defs: rest } : {}) };
  }
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: `${SCHEMA_BASE_ID}/${name}.schema.json`,
    ...root,
  };
}

/** Build all schemas in memory (used by the emitter and by tests). */
export function buildJsonSchemas(): Record<SchemaName, JsonRecord> {
  const out = {} as Record<SchemaName, JsonRecord>;
  for (const [name, schema] of TARGETS) {
    out[name] = toRootSchema(name, schema);
  }
  return out;
}

export function serializeSchema(schema: JsonRecord): string {
  return `${JSON.stringify(schema, null, 2)}\n`;
}

function main(): void {
  const outDir = join(process.cwd(), 'server', 'webflix-lab', 'src', 'contracts', 'schemas');
  mkdirSync(outDir, { recursive: true });
  const built = buildJsonSchemas();
  for (const [name, schema] of Object.entries(built) as [SchemaName, JsonRecord][]) {
    const file = join(outDir, `${name}.schema.json`);
    writeFileSync(file, serializeSchema(schema), 'utf8');
    console.log(`emitted ${file}`);
  }
}

if (import.meta.main) {
  main();
}
