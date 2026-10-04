/**
 * Audio pipeline (WFLX-W2, Stage 2) — turn-taking naturalness analysis.
 *
 * Post-freeze positioning (DESIGN.md §16.2 item 4): the PLAN's turn structure
 * is authoritative; W2 ANALYZES it for conversational naturalness and surfaces
 * findings as QA issues feeding back to the Director — it never rewrites
 * speaker assignment. Checks (mode-semantics.md H-A-04):
 *
 *   1. speaker turn-share within the 35–65% band (not forced 50/50),
 *   2. longest strict ABAB alternation run bounded (no whole-graph parity
 *      walk),
 *   3. question->answer (respondsTo) links and backchannel presence,
 *   4. same-speaker runs bounded (<= 2 consecutive, justified purpose units).
 *
 * The canonical deep-dive fixture (host-a 12 / host-b 10, no interjection
 * turns, a 19-turn strict-alternation stretch) is honestly REPORTED by these
 * checks — that is the fixture-gap documented in DESIGN.md §16.4 item 3.
 *
 * The product-level claim that real Audio Overviews converse naturally is
 * HYPOTHESIS until EXP-A black-box runs (tests/audio/mode-semantics.md §0).
 */

import type { DialogueGraph } from './types';

/** Naturalness findings for one graph (all values deterministic). */
export interface TurnTakingStats {
  readonly turnCount: number;
  /** speakerRole -> share of turns in [0, 1]. */
  readonly speakerShares: Readonly<Record<string, number>>;
  /** Longest run of consecutive strictly-alternating speakers. */
  readonly longestAlternationRun: number;
  /** Longest run of consecutive same-speaker turns. */
  readonly longestSameSpeakerRun: number;
  /** Number of question->answer (respondsTo) links. */
  readonly questionAnswerPairs: number;
  /** Number of acknowledgement/interjection turns (backchannels). */
  readonly backchannelTurns: number;
  /** Speaker parity: true when share is inside the 35–65% band. */
  readonly parityBalanced: boolean;
}

/** Analyze turn-taking structure of the graph. Pure; no mutation. */
export function analyzeTurnTaking(graph: DialogueGraph): TurnTakingStats {
  const turns = graph.turns;
  const counts = new Map<string, number>();
  for (const turn of turns) {
    counts.set(turn.speakerRole, (counts.get(turn.speakerRole) ?? 0) + 1);
  }
  const speakerShares: Record<string, number> = {};
  for (const [role, count] of counts) {
    speakerShares[role] = turns.length === 0 ? 0 : count / turns.length;
  }
  const parityBalanced = [...Object.values(speakerShares)].every(
    (share) => share >= 0.35 && share <= 0.65,
  );

  let longestAlternationRun = turns.length > 0 ? 1 : 0;
  let currentAlternationRun = turns.length > 0 ? 1 : 0;
  let longestSameSpeakerRun = turns.length > 0 ? 1 : 0;
  let currentSameSpeakerRun = turns.length > 0 ? 1 : 0;
  for (let i = 1; i < turns.length; i += 1) {
    const prev = turns[i - 1];
    const curr = turns[i];
    if (prev === undefined || curr === undefined) continue;
    if (prev.speakerRole !== curr.speakerRole) {
      currentAlternationRun += 1;
      currentSameSpeakerRun = 1;
    } else {
      currentAlternationRun = 1;
      currentSameSpeakerRun += 1;
    }
    longestAlternationRun = Math.max(longestAlternationRun, currentAlternationRun);
    longestSameSpeakerRun = Math.max(longestSameSpeakerRun, currentSameSpeakerRun);
  }

  const questionAnswerPairs = turns.reduce(
    (acc, turn) => acc + turn.links.respondsTo.length,
    0,
  );
  const backchannelTurns = turns.filter((turn) => turn.purpose === 'interjection').length;

  return {
    turnCount: turns.length,
    speakerShares,
    longestAlternationRun,
    longestSameSpeakerRun,
    questionAnswerPairs,
    backchannelTurns,
    parityBalanced,
  };
}

/** Issue thresholds (lab defaults; tunable, UNRESOLVED vs the product). */
export const TURN_TAKING_THRESHOLDS = {
  /** Alternation run is suspicious when >= this many turns… */
  alternationRunAbsolute: 12,
  /** …and >= this share of the whole graph. */
  alternationRunShare: 0.6,
  /** Same-speaker runs above this are unjustified (DESIGN.md §3.4 rule 4). */
  maxSameSpeakerRun: 2,
} as const;
