/**
 * Audio pipeline (WFLX-W2, Stage 2) — the DialogueGraph engine.
 *
 * Builds W2's working representation FROM the plan's authoritative
 * `audioTurns` (DESIGN.md §16.2 item 1): enriched tags (item 5), debate
 * stances (HYPOTHESIS-grade, §16.4 item 1), conversational links, section
 * roles and rate-model word budgets. Then validates the grounding rules that
 * are W2-specific semantics (defense in depth on top of W1's deep validation,
 * §16.2 item 6):
 *
 *   - every factual turn cites >= 1 claim id that exists in the plan's graph
 *     (zero-claim turns are restricted to structural/conversational purposes),
 *   - enriched tags project back onto the frozen purpose (internal invariant),
 *   - a debate rebuttal cites different claim ids than the position it rebuts
 *     (rebuttal-by-restatement is a validation error, DESIGN.md §4.4),
 *   - link targets exist.
 *
 * Deterministic and seeded: identical (plan, graph, seed) => identical graph.
 */

import { createHash } from 'node:crypto';
import {
  OverviewPlanSchema,
  type AudioOverviewMode,
  type AudioTurn,
  type Id,
  type OverviewPlan,
  type SemanticGraph,
  type SpeakerRole,
} from '../../contracts';
import { AudioCompilerError, type DialogueValidationIssue } from '../errors';
import { modeProfileFor } from '../modes';
import { deriveEnrichedTag, deriveStance, PACING_MULTIPLIERS } from '../modes/common';
import type { ModeProfile } from '../modes/common';
import { derivePersonas } from './personas';
import {
  ENRICHED_TAG_TO_PURPOSE,
  ZERO_CLAIM_ALLOWED_PURPOSES,
  type BeatIndex,
  type ClaimIndex,
  type DialogueGraph,
  type DialogueTurn,
  type SpeakerPersona,
  type SpeakerStance,
} from './types';

// ---------------------------------------------------------------------------
// Canonical hashing
// ---------------------------------------------------------------------------

/** Recursively order-insensitive stringify: object keys sorted everywhere. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** SHA-256 of the canonical JSON serialization of a plan (planHash). */
export function planHashOf(plan: unknown): string {
  return createHash('sha256').update(stableStringify(plan), 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// Graph construction
// ---------------------------------------------------------------------------

export interface BuildGraphInput {
  readonly plan: OverviewPlan;
  readonly graph: SemanticGraph;
  /** Deterministic seed (string form; keys every stochastic choice). */
  readonly seed: string;
}

/** Answer-ish purposes: a different-speaker turn that follows a question. */
const ANSWER_PURPOSES = new Set([
  'explanation',
  'example',
  'clarification',
  'framing',
  'synthesis',
  'conclusion',
]);

function sectionRoleFor(
  beatId: Id | undefined,
  beatIndex: BeatIndex,
  beatCount: number,
): 'opening' | 'body' | 'closing' {
  if (beatId === undefined) return 'body';
  const beat = beatIndex.get(beatId);
  if (beat === undefined) return 'body';
  if (beat.index === 0) return 'opening';
  if (beat.index === beatCount - 1 && beatCount >= 3) return 'closing';
  return 'body';
}

/** Build the DialogueGraph from the plan. Assumes the plan passed its zod guard. */
export function buildDialogueGraph(input: BuildGraphInput): DialogueGraph {
  const { plan, graph, seed } = input;
  if (plan.modality !== 'audio') {
    throw new AudioCompilerError(
      'invalid-plan',
      `audio compiler requires an audio-modality plan (got '${plan.modality}')`,
    );
  }
  const audioPlan = plan as OverviewPlan & { modality: 'audio'; mode: AudioOverviewMode };
  const profile: ModeProfile = modeProfileFor(audioPlan.mode);

  const claimIndex: ClaimIndex = new Map(graph.claims.map((claim) => [claim.id, claim]));
  const beatIndex: BeatIndex = new Map(plan.beats.map((beat) => [beat.id, beat]));

  const pacingMultiplier = PACING_MULTIPLIERS[plan.style.pacing ?? 'measured'] ?? 1.0;
  const rate = profile.rate.wordsPerSecond * pacingMultiplier;

  // --- pass 1: enriched tags, stances, budgets, sections ---
  const stancesByRole = new Map<SpeakerRole, SpeakerStance>();
  const partial = plan.audioTurns.map((turn) => {
    const enrichedTag = deriveEnrichedTag(profile, turn.purpose, turn.brief);
    const stance = audioPlan.mode === 'debate' ? deriveStance(profile, turn.brief) : 'neutral';
    // First non-neutral signal in plan order wins (deterministic aggregation;
    // later turns mentioning the OPPOSING side — e.g. a con host
    // cross-examining "the pro side" — must not flip the persona stance).
    if (stance !== 'neutral' && !stancesByRole.has(turn.speakerRole)) {
      stancesByRole.set(turn.speakerRole, stance);
    }
    const sectionRole = sectionRoleFor(turn.beatId, beatIndex, plan.beats.length);
    const topicIds = collectTopicIds(turn, claimIndex, beatIndex);
    return {
      turn,
      enrichedTag,
      stance,
      sectionRole,
      topicIds,
      estimatedWords: Math.round(rate * turn.targetDurationSeconds),
    };
  });

  // Stance aggregation: role stance = first non-neutral signal in plan order
  // (deterministic). derivePersonas consumes the map built above.
  const personas: readonly SpeakerPersona[] = derivePersonas(plan, stancesByRole);

  // --- pass 2: conversational links ---
  const respondsTo: string[][] = partial.map(() => []);
  const acknowledges: string[][] = partial.map(() => []);

  partial.forEach((node, i) => {
    const tag = node.enrichedTag;
    const family = ENRICHED_TAG_TO_PURPOSE[tag];

    if (family === 'question') {
      // Question -> the next different-speaker, answer-ish turn answers it.
      for (let j = i + 1; j < partial.length; j += 1) {
        const other = partial[j];
        if (other === undefined) break;
        if (other.turn.speakerRole === node.turn.speakerRole) continue;
        if (other.turn.purpose === 'interjection') continue;
        if (ANSWER_PURPOSES.has(other.turn.purpose)) {
          respondsTo[j]?.push(node.turn.id);
        }
        break;
      }
    }

    if (tag === 'rebuttal') {
      // Rebuttal -> the nearest earlier position_statement by the other speaker.
      for (let j = i - 1; j >= 0; j -= 1) {
        const other = partial[j];
        if (other === undefined) break;
        if (other.turn.speakerRole === node.turn.speakerRole) continue;
        if (other.enrichedTag === 'position_statement') {
          respondsTo[i]?.push(other.turn.id);
          break;
        }
      }
    }

    if (tag === 'acknowledgement') {
      // Backchannel acknowledges the immediately preceding turn.
      const prev = partial[i - 1];
      if (prev !== undefined) {
        acknowledges[i]?.push(prev.turn.id);
      }
    }
  });

  const turns: readonly DialogueTurn[] = partial.map((node, i) => ({
    id: node.turn.id,
    index: node.turn.index,
    speakerRole: node.turn.speakerRole,
    purpose: node.turn.purpose,
    enrichedTag: node.enrichedTag,
    brief: node.turn.brief,
    claimIds: node.turn.claimIds,
    evidence: node.turn.evidence,
    beatId: node.turn.beatId,
    section: { beatId: node.turn.beatId, role: node.sectionRole },
    style: node.turn.style,
    targetDurationSeconds: node.turn.targetDurationSeconds,
    estimatedWords: node.estimatedWords,
    topicIds: node.topicIds,
    links: {
      respondsTo: [...(respondsTo[i] ?? [])],
      acknowledges: [...(acknowledges[i] ?? [])],
    },
    stance: node.stance,
  }));

  return {
    meta: {
      planId: plan.id,
      planHash: planHashOf(plan),
      mode: plan.mode,
      language: plan.language,
      targetDurationSeconds: plan.targetDurationSeconds,
      seed,
    },
    personas,
    turns,
  };
}

function collectTopicIds(
  turn: AudioTurn,
  claimIndex: ClaimIndex,
  beatIndex: BeatIndex,
): readonly Id[] {
  const topics = new Set<Id>();
  for (const claimId of turn.claimIds) {
    const claim = claimIndex.get(claimId);
    if (claim !== undefined) {
      for (const topicId of claim.topicIds) topics.add(topicId);
    }
  }
  if (topics.size === 0 && turn.beatId !== undefined) {
    const beat = beatIndex.get(turn.beatId);
    if (beat !== undefined) {
      for (const topicId of beat.topicIds) topics.add(topicId);
    }
  }
  return [...topics];
}

// ---------------------------------------------------------------------------
// Hard validation (grounding rules; throws via compileAudioOverview)
// ---------------------------------------------------------------------------

/**
 * Validate the built graph against the grounding rules. These checks are
 * redundant with W1's deep validation BY DESIGN (defense in depth at the
 * audio boundary, DESIGN.md §16.2 item 6) plus W2-specific semantics
 * (rebuttal restatement, zero-claim allowlist).
 */
export function validateDialogueGraph(
  graph: DialogueGraph,
  claimIndex: ClaimIndex,
): readonly DialogueValidationIssue[] {
  const issues: DialogueValidationIssue[] = [];
  const turnById = new Map<string, DialogueTurn>(graph.turns.map((turn) => [turn.id, turn]));

  for (const turn of graph.turns) {
    const path = `audioTurns.${turn.id}`;

    // Enriched tag invariant (internal consistency, §16.2 item 5).
    if (ENRICHED_TAG_TO_PURPOSE[turn.enrichedTag] !== turn.purpose) {
      issues.push({
        code: 'enriched-tag-mismatch',
        path: `${path}.enrichedTag`,
        message: `enriched tag '${turn.enrichedTag}' must project onto frozen purpose '${turn.purpose}'`,
        turnId: turn.id,
      });
    }

    // Grounding rule §3.2: factual turns need >= 1 resolvable claim id.
    if (!ZERO_CLAIM_ALLOWED_PURPOSES.has(turn.purpose) && turn.claimIds.length === 0) {
      issues.push({
        code: 'ungrounded-factual-turn',
        path: `${path}.claimIds`,
        message: `factual purpose '${turn.purpose}' requires at least one claim id (zero-claim turns are restricted to structural/conversational purposes)`,
        turnId: turn.id,
      });
    }

    for (const claimId of turn.claimIds) {
      if (!claimIndex.has(claimId)) {
        issues.push({
          code: 'unknown-claim-ref',
          path: `${path}.claimIds`,
          message: `references unknown claim ${claimId} (not in the plan's semantic graph)`,
          turnId: turn.id,
        });
      }
    }
  }

  // Debate rule: a rebuttal must cite different claim ids than the position
  // it rebuts (rebuttal-by-restatement is a validation error, DESIGN.md §4.4).
  for (const turn of graph.turns) {
    if (turn.enrichedTag !== 'rebuttal') continue;
    for (const targetId of turn.links.respondsTo) {
      const target = turnById.get(targetId);
      if (target === undefined) continue;
      const overlap = turn.claimIds.filter((id) => target.claimIds.includes(id));
      if (overlap.length > 0) {
        issues.push({
          code: 'rebuttal-restatement',
          path: `audioTurns.${turn.id}.claimIds`,
          message: `rebuttal restates position ${targetId}: both cite ${overlap.join(', ')} — a rebuttal must cite different claim ids`,
          turnId: turn.id,
        });
      }
    }
  }

  // Link targets must exist.
  for (const turn of graph.turns) {
    for (const targetId of [...turn.links.respondsTo, ...turn.links.acknowledges]) {
      if (!turnById.has(targetId)) {
        issues.push({
          code: 'dangling-link-target',
          path: `audioTurns.${turn.id}.links`,
          message: `links reference unknown turn ${targetId}`,
          turnId: turn.id,
        });
      }
    }
  }

  return issues;
}

/**
 * Build + validate in one step; throws AudioCompilerError on hard failures.
 * Also runs the plan's zod guard defensively (the plan is expected to be
 * pre-validated by W1; this is the audio boundary's own check).
 */
export function buildValidatedDialogueGraph(input: BuildGraphInput): DialogueGraph {
  const guard = OverviewPlanSchema.safeParse(input.plan);
  if (!guard.success) {
    throw new AudioCompilerError(
      'invalid-plan',
      `plan failed its contract guard: ${guard.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
    );
  }
  const claimIndex: ClaimIndex = new Map(
    input.graph.claims.map((claim) => [claim.id, claim]),
  );
  const graph = buildDialogueGraph(input);
  const issues = validateDialogueGraph(graph, claimIndex);
  if (issues.length > 0) {
    throw new AudioCompilerError(
      'dialogue-validation-failed',
      `dialogue graph failed validation (${issues.length} issue${issues.length === 1 ? '' : 's'}): ` +
        issues.map((i) => `${i.code} at ${i.path}`).join('; '),
      issues,
    );
  }
  return graph;
}
