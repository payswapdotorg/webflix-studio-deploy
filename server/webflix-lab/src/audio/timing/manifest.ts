/**
 * Audio pipeline (WFLX-W2, Stage 2) — the TimingManifest.
 *
 * Maps every turn to startMs / endMs / gapAfterMs with target vs actual
 * durations and cumulative totals (DESIGN.md §6). Built twice:
 *   - pre-synthesis: from plan-authoritative target durations,
 *   - post-synthesis: actual provider durations replace estimates; drift
 *     beyond tolerance is reported by QA naming the turn (smallest
 *     regenerable unit).
 *
 * The manifest is the audio side of the future Timeline Composer contract
 * (DESIGN.md §15 integration note): W3 storyboards should reference the same
 * turn ids.
 */

import type { Id } from '../../contracts';
import type { DialogueGraph } from '../dialogue/types';
import type { BoundaryClass } from './timing';
import { classifyBoundary, gapMsFor, type GapPolicyInput } from './timing';

/** One aligned turn. */
export interface TimingEntry {
  readonly turnId: Id;
  readonly index: number;
  readonly speakerRole: string;
  readonly startMs: number;
  readonly endMs: number;
  /** Gap after this turn, before the next (ms). Last turn: its trailing gap, if any. */
  readonly gapAfterMs: number;
  /** Boundary class of the gap after this turn. */
  readonly boundaryAfter: BoundaryClass | 'none';
  /** Plan-authoritative target duration (s). */
  readonly targetSeconds: number;
  /** Measured duration after synthesis (s); equal to target pre-synthesis. */
  readonly actualSeconds: number;
}

/** Whole-dialogue timing manifest. */
export interface TimingManifest {
  readonly planId: Id;
  readonly planHash: string;
  readonly sampleRateHz: number;
  readonly entries: readonly TimingEntry[];
  /** Σ turn durations (actual, seconds). */
  readonly totalTurnSeconds: number;
  /** Σ turn durations (plan targets, seconds). */
  readonly totalTargetSeconds: number;
  /** Σ gaps (ms). */
  readonly gapsTotalMs: number;
  /** Final track duration (ms): Σ turns + Σ gaps. */
  readonly totalDurationMs: number;
}

/** Build the pre-synthesis manifest (target durations; actual == target). */
export function buildTimingManifest(
  graph: DialogueGraph,
  policy: GapPolicyInput,
  sampleRateHz: number,
): TimingManifest {
  const entries: TimingEntry[] = [];
  let cursorMs = 0;
  let gapsTotalMs = 0;
  let totalTargetSeconds = 0;

  graph.turns.forEach((turn, i) => {
    const boundary: BoundaryClass | 'none' =
      i < graph.turns.length - 1 ? classifyBoundary(graph, i) : 'none';
    const gapAfterMs =
      boundary === 'none' ? 0 : gapMsFor(policy, boundary, i);
    const targetSeconds = turn.targetDurationSeconds;
    const durationMs = Math.round(targetSeconds * 1000);
    totalTargetSeconds += targetSeconds;
    gapsTotalMs += gapAfterMs;
    entries.push({
      turnId: turn.id,
      index: turn.index,
      speakerRole: turn.speakerRole,
      startMs: cursorMs,
      endMs: cursorMs + durationMs,
      gapAfterMs,
      boundaryAfter: boundary,
      targetSeconds,
      actualSeconds: targetSeconds,
    });
    cursorMs += durationMs + gapAfterMs;
  });

  const totalTurnSeconds = entries.reduce((acc, entry) => acc + entry.actualSeconds, 0);
  return {
    planId: graph.meta.planId,
    planHash: graph.meta.planHash,
    sampleRateHz,
    entries,
    totalTurnSeconds,
    totalTargetSeconds,
    gapsTotalMs,
    totalDurationMs: cursorMs,
  };
}

/**
 * Rebuild the manifest with measured (actual) turn durations from speech
 * synthesis, keeping the same seeded gaps. `actualSecondsByTurnId` carries
 * provider-measured durations.
 */
export function retimingManifest(
  manifest: TimingManifest,
  actualSecondsByTurnId: ReadonlyMap<Id, number>,
): TimingManifest {
  const entries: TimingEntry[] = [];
  let cursorMs = 0;
  let gapsTotalMs = 0;
  manifest.entries.forEach((entry) => {
    const actual = actualSecondsByTurnId.get(entry.turnId) ?? entry.actualSeconds;
    const durationMs = Math.round(actual * 1000);
    gapsTotalMs += entry.gapAfterMs;
    entries.push({
      ...entry,
      startMs: cursorMs,
      endMs: cursorMs + durationMs,
      actualSeconds: actual,
    });
    cursorMs += durationMs + entry.gapAfterMs;
  });
  const totalTurnSeconds = entries.reduce((acc, entry) => acc + entry.actualSeconds, 0);
  return {
    ...manifest,
    entries,
    totalTurnSeconds,
    gapsTotalMs,
    totalDurationMs: cursorMs,
  };
}
