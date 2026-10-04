/**
 * Audio pipeline (WFLX-W2, Stage 2) — timing gap policy and boundary classes.
 *
 * Gap policy per DESIGN.md §6 (initial lab values, UNRESOLVED against the
 * real product — no audio black-box baseline yet; explicitly tunable):
 *
 *   | Boundary class       | Gap (ms)   |
 *   | question -> answer   | 80–150     |
 *   | within cluster       | 150–300    |
 *   | topic boundary       | 300–600    |
 *   | section boundary     | 400–900    |
 *   | around backchannel   | 60–120     |
 *
 * Mode scaling: Brief shortens gaps (×0.5, DESIGN.md §4.2). Jitter within a
 * class range is seeded by (seed, gap-adjacent turn content hashes, gap
 * index) — reproducible; C-5 v2 re-keying (src/contracts/unit-content-hash.ts
 * documents this composition as the audio timing-gap surface): the key is
 * seed|unitContentHash([turnHashA, turnHashB])|gap-N|boundary, so a
 * one-claim change reshuffles only the gaps adjacent to changed turns.
 *
 * §16.3: the plan is duration-authoritative; gaps are extra. The timing
 * engine checks total = Σ turns + Σ gaps against targetDurationSeconds and
 * reports drift instead of cutting content.
 */

import type { DialogueGraph } from '../dialogue/types';
import { unitContentHash } from '../../contracts';
import { intFor } from '../rng';

/** Boundary classes in priority order (most specific first). */
export type BoundaryClass = 'question-answer' | 'backchannel' | 'section' | 'topic' | 'cluster';

/** Gap policy table (ms, inclusive ranges; DESIGN.md §6 defaults). */
export const GAP_POLICY: Readonly<Record<BoundaryClass, { readonly minMs: number; readonly maxMs: number }>> = {
  'question-answer': { minMs: 80, maxMs: 150 },
  backchannel: { minMs: 60, maxMs: 120 },
  section: { minMs: 400, maxMs: 900 },
  topic: { minMs: 300, maxMs: 600 },
  cluster: { minMs: 150, maxMs: 300 },
};

export interface GapPolicyInput {
  readonly seed: string;
  /**
   * Turn-LOCAL content hashes (spoken order; src/audio/dialogue/text/
   * realizer.ts turnContentHash) — the C-5 v2 re-keying input. The gap
   * between turn i and turn i+1 keys on the hashes at i and i+1; the
   * plan-global planHash is REMOVED from stochastic keys (it stays in
   * identification surfaces only).
   */
  readonly turnContentHashes: readonly string[];
  /** Mode gap scale (DESIGN.md §4.2 Brief ×0.5; deep-dive/critique ×1.0; debate ×0.9). */
  readonly gapScale: number;
}

/**
 * Classify the boundary between turn i and its successor (priority order:
 * question-answer > backchannel > section > topic > cluster).
 */
export function classifyBoundary(
  graph: DialogueGraph,
  index: number,
): BoundaryClass {
  const turns = graph.turns;
  const current = turns[index];
  const next = turns[index + 1];
  if (current === undefined || next === undefined) {
    throw new RangeError(`classifyBoundary: no boundary after index ${index}`);
  }

  // Backchannel adjacency: either side is a short acknowledgement turn.
  if (current.enrichedTag === 'acknowledgement' || next.enrichedTag === 'acknowledgement') {
    return 'backchannel';
  }

  // Question -> different-speaker answer.
  if (
    current.purpose === 'question' &&
    next.speakerRole !== current.speakerRole &&
    next.purpose !== 'interjection'
  ) {
    return 'question-answer';
  }

  // Beat change = section boundary.
  if (current.beatId !== next.beatId) {
    return 'section';
  }

  // Topic set change within a beat = topic boundary.
  const currentTopics = new Set(current.topicIds);
  const nextTopics = new Set(next.topicIds);
  const disjoint =
    currentTopics.size === 0 ||
    nextTopics.size === 0 ||
    [...nextTopics].every((topic) => !currentTopics.has(topic));
  if (disjoint) {
    return 'topic';
  }

  return 'cluster';
}

/** Seeded gap (ms) for a boundary class, scaled by the mode factor.
 * C-5: keyed on the gap-adjacent turns' content hashes (see the module
 * docblock and src/contracts/unit-content-hash.ts). */
export function gapMsFor(input: GapPolicyInput, boundary: BoundaryClass, gapIndex: number): number {
  const hashA = input.turnContentHashes[gapIndex];
  const hashB = input.turnContentHashes[gapIndex + 1];
  if (hashA === undefined || hashB === undefined) {
    throw new RangeError(
      `gapMsFor: no gap-adjacent turn content hashes for gap ${gapIndex} ` +
        `(have ${input.turnContentHashes.length} hashes)`,
    );
  }
  const policy = GAP_POLICY[boundary];
  const scaledMin = Math.round(policy.minMs * input.gapScale);
  const scaledMax = Math.round(policy.maxMs * input.gapScale);
  return intFor(
    `${input.seed}|${unitContentHash([hashA, hashB])}|gap-${gapIndex}|${boundary}`,
    scaledMin,
    scaledMax,
  );
}

/** Scaled policy bounds for QA (pause_distribution checks against these). */
export function scaledGapBounds(gapScale: number, boundary: BoundaryClass): { minMs: number; maxMs: number } {
  const policy = GAP_POLICY[boundary];
  return {
    minMs: Math.round(policy.minMs * gapScale),
    maxMs: Math.round(policy.maxMs * gapScale),
  };
}
