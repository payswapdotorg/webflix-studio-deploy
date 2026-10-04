/**
 * WebFlix-Lab shared IR — the turn rate / mass-budget model (C-7, v2
 * contract wave; ruling 2026-09-29).
 *
 * ONE authoritative rate model for every surface that plans or voices
 * turns. Until v2 these constants lived only in src/director/compiler.ts
 * as documented mirrors of W2-internal priors (src/audio/modes/* rate
 * ceilings, src/audio/dialogue/types.ts ZERO_CLAIM_ALLOWED_PURPOSES) —
 * the mirror was conservative (2.5 wps vs the tightest effective mode
 * ceiling 2.87 wps) but unaudited: a W2 retune could silently widen the
 * gap (EV-008, WFLX-P3A handoff 1). LAB-03 adds product truth: the real
 * Length control scales per-topic depth within rate ceilings — a shared
 * rate model is the contract-level surface for that behavior (EV-009).
 *
 * Additive at landing (v2.0.0): values are IDENTICAL to the Director
 * constants they replace; src/director/compiler.ts re-exports
 * TURN_PLANNING_RATE_WPS for API stability and consumes everything from
 * here. C-7 alone produces ZERO output change (byte-identical benchmark
 * content; proven at the C-7 commit before any re-keying lands).
 *
 * The W2-internal priors above remain W2-owned implementation details;
 * this module is the shared CONTRACT surface the Director and the audio
 * surface agree on, not a seizure of W2's tree.
 */

import type { AudioTurnPurpose } from './audio-turn';

/**
 * Planning rate (words/second) at which a turn slot can voice its anchor
 * mass. A conservative editorial prior BELOW every audio mode's effective
 * rate ceiling (tightest: deep-dive/critique 2.6 wps x 0.96 measured pacing
 * x 1.15 ceiling multiplier = 2.87 wps), so a mass-fitting slot can never be
 * flagged turn-over-budget by the audio compiler's check (DESIGN.md §16.2
 * item 3: W2 fits text density; the Director must not hand it impossible
 * slots). HYPOTHESIS lab policy, testable per the experiment matrix.
 */
export const TURN_PLANNING_RATE_WPS = 2.5;

/**
 * Purposes whose turns are factual carriers: the audio grounding rule
 * (src/audio/dialogue/types.ts ZERO_CLAIM_ALLOWED_PURPOSES) requires them
 * to cite at least one claim. Documented dependency, deliberately not an
 * import (worker path ownership: src/audio is W2's tree); the mirror is
 * audited by the v2 wave and must stay aligned (EV-008).
 */
export const FACTUAL_TURN_PURPOSES: ReadonlySet<AudioTurnPurpose> = new Set([
  'explanation',
  'example',
  'connection',
  'clarification',
]);

/**
 * Worst-case mass (countWords tokens) the realizer's BARE anchor block adds:
 * the longest question tail across the surface packs plus the em-dash
 * separator ("is that actually supported by the evidence?" + "—").
 */
export const QUESTION_TAIL_TOKENS = 8;

/** Worst-case mass of one anchor connector between two anchors in one turn. */
export const ANCHOR_CONNECTOR_TOKENS = 5;

/**
 * Conversational-tissue allowance for topical (claim-less) turns: opener +
 * a speaking pace's worth of orientation glue beyond the beat title.
 */
export const TOPICAL_TISSUE_TOKENS = 8;

/** Minimum turn duration (s). */
export const MIN_TURN_SECONDS = 2;
