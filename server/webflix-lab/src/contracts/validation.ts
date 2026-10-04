/**
 * WebFlix-Lab shared IR — deep (cross-record) validators.
 *
 * zod guards enforce shape, per-field constraints and within-record
 * cross-field rules. These validators enforce the semantics that need more
 * than one record: block/offset arithmetic against the actual source text,
 * quote equality, fingerprint correctness, graph-to-source grounding,
 * plan-to-graph coverage accounting, and duration/weight budgets.
 *
 * Precondition: inputs already pass their zod guard. Tests always run
 * guard -> deep validation in that order.
 */

import { createHash } from 'node:crypto';
import type { SourceArtifact, SourceBlock } from './source-artifact';
import type { SemanticGraph } from './semantic-graph';
import type { EvidenceSpan } from './primitives';
import type { OverviewPlan } from './overview-plan';

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface DeepValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function result(issues: ValidationIssue[]): DeepValidationResult {
  return { valid: issues.length === 0, issues };
}

function issue(path: string, message: string): ValidationIssue {
  return { path, message };
}

class BlockIndex {
  /**
   * Blocks are keyed by the (sourceId, blockId) PAIR: every adapter numbers
   * block ids per-source from b1, so blockId alone is NOT unique across the
   * sources of a multi-source graph — only the pair is (the W1 multi-source
   * law; fixed 2026-10-03, work order 34-WFLX-V3A).
   */
  private readonly byPair = new Map<string, { source: SourceArtifact; block: SourceBlock }>();

  constructor(sources: readonly SourceArtifact[]) {
    for (const source of sources) {
      for (const block of source.blocks) {
        const key = `${source.id}\u0000${block.id}`;
        // First definition wins; the pair key makes this a no-op in valid data.
        if (!this.byPair.has(key)) {
          this.byPair.set(key, { source, block });
        }
      }
    }
  }

  get(sourceId: string, blockId: string): { source: SourceArtifact; block: SourceBlock } | undefined {
    return this.byPair.get(`${sourceId}\u0000${blockId}`);
  }
}

function verifySpan(
  span: EvidenceSpan,
  sources: readonly SourceArtifact[],
  blocks: BlockIndex,
  path: string,
  issues: ValidationIssue[],
): void {
  const source = sources.find((s) => s.id === span.sourceId);
  if (source === undefined) {
    issues.push(issue(path, `references unknown source ${span.sourceId}`));
    return;
  }
  const hit = blocks.get(span.sourceId, span.blockId);
  if (hit === undefined) {
    issues.push(issue(path, `references unknown block ${span.blockId} in source ${span.sourceId}`));
    return;
  }
  if (span.start < hit.block.start || span.end > hit.block.end) {
    issues.push(
      issue(
        path,
        `span [${span.start}, ${span.end}) escapes block ${hit.block.id} [${hit.block.start}, ${hit.block.end})`,
      ),
    );
    return;
  }
  const sliced = source.text.slice(span.start, span.end);
  if (sliced !== span.quote) {
    issues.push(
      issue(path, `quote does not equal text.slice(start, end): ${JSON.stringify(span.quote)} != ${JSON.stringify(sliced)}`),
    );
  }
}

/** Structural + fingerprint consistency of a SourceArtifact. */
export function validateSourceArtifact(artifact: SourceArtifact): DeepValidationResult {
  const issues: ValidationIssue[] = [];
  const { text, blocks, fingerprint } = artifact;

  if (sha256Hex(text) !== fingerprint.contentSha256) {
    issues.push(issue('fingerprint.contentSha256', 'does not equal sha256 of text'));
  }
  if (fingerprint.textLength !== text.length) {
    issues.push(
      issue('fingerprint.textLength', `expected ${text.length}, got ${fingerprint.textLength}`),
    );
  }
  const words = countWords(text);
  if (words !== artifact.wordCount) {
    issues.push(issue('wordCount', `expected ${words}, got ${artifact.wordCount}`));
  }

  let cursor = -1;
  for (const block of blocks) {
    const path = `blocks.${block.id}`;
    if (block.start <= cursor) {
      issues.push(issue(path, `blocks must be ordered and non-overlapping (start ${block.start} <= previous end ${cursor})`));
    }
    if (block.end > text.length) {
      issues.push(issue(path, `end ${block.end} exceeds text length ${text.length}`));
    }
    if (text.slice(block.start, block.end) !== block.text) {
      issues.push(issue(path, 'block.text does not equal text.slice(start, end)'));
    }
    if (block.text.trim().length === 0) {
      issues.push(issue(path, 'block text must not be blank'));
    }
    cursor = Math.max(cursor, block.end);
  }
  return result(issues);
}

/** Graph grounding against the concrete source artifacts. */
export function validateSemanticGraph(
  graph: SemanticGraph,
  sources: SourceArtifact | readonly SourceArtifact[],
): DeepValidationResult {
  const issues: ValidationIssue[] = [];
  const sourceList = Array.isArray(sources) ? sources : [sources];
  const byId = new Map(sourceList.map((s) => [s.id, s] as const));
  const blocks = new BlockIndex(sourceList);

  for (const sourceId of graph.sourceIds) {
    if (!byId.has(sourceId)) {
      issues.push(issue('sourceIds', `source ${sourceId} is not among the provided sources`));
    }
  }
  for (const source of sourceList) {
    if (!graph.sourceIds.includes(source.id)) {
      issues.push(issue('sourceIds', `provided source ${source.id} is missing from graph.sourceIds`));
    }
  }

  for (const claim of graph.claims) {
    claim.evidence.forEach((span, i) => {
      verifySpan(span, sourceList, blocks, `claims.${claim.id}.evidence.${i}`, issues);
    });
  }
  for (const rel of graph.relationships) {
    rel.evidence.forEach((span, i) => {
      verifySpan(span, sourceList, blocks, `relationships.${rel.id}.evidence.${i}`, issues);
    });
  }
  for (const entity of graph.entities) {
    entity.mentions.forEach((mention, i) => {
      const path = `entities.${entity.id}.mentions.${i}`;
      const source = byId.get(mention.sourceId);
      if (source === undefined) {
        issues.push(issue(path, `references unknown source ${mention.sourceId}`));
        return;
      }
      const hit = blocks.get(mention.sourceId, mention.blockId);
      if (hit === undefined) {
        issues.push(issue(path, `references unknown block ${mention.blockId}`));
        return;
      }
      if (mention.start < hit.block.start || mention.end > hit.block.end) {
        issues.push(issue(path, `mention escapes block ${hit.block.id}`));
        return;
      }
      const sliced = source.text.slice(mention.start, mention.end);
      if (sliced !== mention.text) {
        issues.push(issue(path, `mention text != text.slice(start, end): ${JSON.stringify(mention.text)} != ${JSON.stringify(sliced)}`));
      }
    });
  }
  for (const topic of graph.topics) {
    topic.blockRefs.forEach((ref, i) => {
      if (blocks.get(ref.sourceId, ref.blockId) === undefined) {
        issues.push(issue(`topics.${topic.id}.blockRefs.${i}`, `references unknown block ${ref.blockId} in source ${ref.sourceId}`));
      }
    });
  }
  return result(issues);
}

function verifyClaimRefs(
  claimIds: readonly string[],
  claimUniverse: Set<string>,
  path: string,
  issues: ValidationIssue[],
): void {
  for (const claimId of claimIds) {
    if (!claimUniverse.has(claimId)) {
      issues.push(issue(path, `references unknown claim ${claimId}`));
    }
  }
}

function verifyTurnEvidence(
  plan: OverviewPlan,
  sources: readonly SourceArtifact[],
  blocks: BlockIndex,
  issues: ValidationIssue[],
): void {
  for (const turn of plan.audioTurns) {
    turn.evidence.forEach((span, i) => {
      verifySpan(span, sources, blocks, `audioTurns.${turn.id}.evidence.${i}`, issues);
    });
  }
}

/** Plan consistency against its graph and sources: coverage accounting, budgets, unit wiring. */
export function validateOverviewPlan(
  plan: OverviewPlan,
  graph: SemanticGraph,
  sources: SourceArtifact | readonly SourceArtifact[],
): DeepValidationResult {
  const issues: ValidationIssue[] = [];
  const sourceList = Array.isArray(sources) ? sources : [sources];
  const blocks = new BlockIndex(sourceList);
  const claimUniverse = new Set(graph.claims.map((c) => c.id));
  const beatIds = new Set(plan.beats.map((b) => b.id));
  const unitIds = new Set<string>([
    ...plan.beats.map((b) => b.id),
    ...plan.audioTurns.map((t) => t.id),
    ...plan.videoScenes.map((s) => s.id),
  ]);

  for (const sourceId of graph.sourceIds) {
    if (!plan.sourceIds.includes(sourceId)) {
      issues.push(issue('sourceIds', `graph source ${sourceId} is not among plan.sourceIds`));
    }
  }

  // --- coverage accounting: every graph claim covered or omitted, no doubles ---
  const coveredIds: string[] = [];
  plan.coverage.covered.forEach((entry, i) => {
    const path = `coverage.covered.${i}`;
    if (!claimUniverse.has(entry.claimId)) {
      issues.push(issue(path, `references unknown claim ${entry.claimId}`));
    }
    coveredIds.push(entry.claimId);
    for (const unitId of entry.unitIds) {
      if (!unitIds.has(unitId)) {
        issues.push(issue(`${path}.unitIds`, `references unknown narrative unit ${unitId}`));
      }
    }
  });
  if (new Set(coveredIds).size !== coveredIds.length) {
    issues.push(issue('coverage.covered', 'claim ids must be unique'));
  }
  const omittedIds = plan.coverage.omitted.map((o) => o.claimId);
  if (new Set(omittedIds).size !== omittedIds.length) {
    issues.push(issue('coverage.omitted', 'claim ids must be unique'));
  }
  for (const claimId of omittedIds) {
    if (coveredIds.includes(claimId)) {
      issues.push(issue('coverage.omitted', `claim ${claimId} is both covered and omitted`));
    }
  }
  const accounted = new Set([...coveredIds, ...omittedIds]);
  for (const claim of graph.claims) {
    if (!accounted.has(claim.id)) {
      issues.push(
        issue('coverage', `claim ${claim.id} is neither covered nor omitted (every graph claim must be editorially accounted for)`),
      );
    }
  }

  // --- beats ---
  plan.beats.forEach((beat, i) => {
    if (beat.index !== i) {
      issues.push(issue(`beats.${beat.id}.index`, `expected ${i}, got ${beat.index}`));
    }
    verifyClaimRefs(beat.claimIds, claimUniverse, `beats.${beat.id}.claimIds`, issues);
    const topicUniverse = new Set(graph.topics.map((t) => t.id));
    for (const topicId of beat.topicIds) {
      if (!topicUniverse.has(topicId)) {
        issues.push(issue(`beats.${beat.id}.topicIds`, `references unknown topic ${topicId}`));
      }
    }
  });
  const weightSum = plan.beats.reduce((acc, b) => acc + b.weight, 0);
  if (Math.abs(weightSum - 1) > 0.005) {
    issues.push(issue('beats', `beat weights must sum to 1 (got ${weightSum})`));
  }

  // --- audio turns ---
  if (plan.modality === 'audio') {
    plan.audioTurns.forEach((turn, i) => {
      if (turn.index !== i) {
        issues.push(issue(`audioTurns.${turn.id}.index`, `expected ${i}, got ${turn.index}`));
      }
      if (turn.beatId !== undefined && !beatIds.has(turn.beatId)) {
        issues.push(issue(`audioTurns.${turn.id}.beatId`, `references unknown beat ${turn.beatId}`));
      }
      verifyClaimRefs(turn.claimIds, claimUniverse, `audioTurns.${turn.id}.claimIds`, issues);
    });
    const durationSum = plan.audioTurns.reduce((acc, t) => acc + t.targetDurationSeconds, 0);
    const tolerance = Math.max(10, plan.targetDurationSeconds * 0.1);
    if (Math.abs(durationSum - plan.targetDurationSeconds) > tolerance) {
      issues.push(
        issue(
          'audioTurns',
          `turn durations sum to ${durationSum}s, outside tolerance ${tolerance.toFixed(1)}s of target ${plan.targetDurationSeconds}s`,
        ),
      );
    }
    verifyTurnEvidence(plan, sourceList, blocks, issues);
  }

  // --- video scenes ---
  if (plan.modality === 'video') {
    const turnIds = new Set(plan.audioTurns.map((t) => t.id));
    plan.videoScenes.forEach((scene, i) => {
      const path = `videoScenes.${scene.id}`;
      if (scene.index !== i) {
        issues.push(issue(`${path}.index`, `expected ${i}, got ${scene.index}`));
      }
      if (scene.beatId !== undefined && !beatIds.has(scene.beatId)) {
        issues.push(issue(`${path}.beatId`, `references unknown beat ${scene.beatId}`));
      }
      if (plan.audioTurns.length > 0 && scene.narrationRef !== undefined && !turnIds.has(scene.narrationRef)) {
        issues.push(issue(`${path}.narrationRef`, `references unknown AudioTurn ${scene.narrationRef}`));
      }
      verifyClaimRefs(scene.claimIds, claimUniverse, `${path}.claimIds`, issues);
      if (
        (scene.renderingClass === 'deterministic' || scene.renderingClass === 'hybrid') &&
        !scene.exactTexts.some((t) => t.exact)
      ) {
        issues.push(
          issue(
            `${path}.exactTexts`,
            `${scene.renderingClass} scenes need at least one exact text item (scene atlas rule 2: exact labels render from structured facts)`,
          ),
        );
      }
    });
    const durationSum = plan.videoScenes.reduce((acc, s) => acc + s.targetDurationSeconds, 0);
    const tolerance = Math.max(10, plan.targetDurationSeconds * 0.1);
    if (Math.abs(durationSum - plan.targetDurationSeconds) > tolerance) {
      issues.push(
        issue(
          'videoScenes',
          `scene durations sum to ${durationSum}s, outside tolerance ${tolerance.toFixed(1)}s of target ${plan.targetDurationSeconds}s`,
        ),
      );
    }
  }

  return result(issues);
}
