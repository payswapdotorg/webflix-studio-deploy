/**
 * Audio pipeline (WFLX-W2, Stage 2) — mode compiler commons.
 *
 * Post-freeze positioning (DESIGN.md §16.2 item 2): mode compilers do not
 * invent turn structure (the plan's `audioTurns` are authoritative). A mode
 * profile contributes:
 *   - a speaking-rate model (words/second + mode bounds) for text-density
 *     fitting within each turn's authoritative target duration (§16.2 item 3),
 *   - a gap-policy scale factor for the timing engine (§6 values are lab
 *     defaults, UNRESOLVED vs the product),
 *   - enriched-tag derivation rules (deterministic brief/purpose patterns),
 *   - debate stance derivation rules (HYPOTHESIS-grade, §16.4 item 1),
 *   - surface-template overlays per conversational tag family,
 *   - mode-semantics QA expectations (flag plans whose turn structure
 *     violates mode semantics — feedback to the Director, never a rewrite).
 */

import type { AudioTurnPurpose } from '../../contracts';
import type { EnrichedTurnTag, SpeakerStance } from '../dialogue/types';

// ---------------------------------------------------------------------------
// Rate model (DESIGN.md §5.1: baseline 2.4–2.8 words/s ≈ 145–170 wpm)
// ---------------------------------------------------------------------------

export interface RateModel {
  /** Target speaking rate in words per second for this mode. */
  readonly wordsPerSecond: number;
  /** Lower rate bound multiplier — realized text may not fall below. */
  readonly floorMultiplier: number;
  /** Upper rate bound multiplier — realized text may not exceed (no velocity hack, H-A-05). */
  readonly ceilMultiplier: number;
}

/** Plan pacing direction -> rate multiplier (lab default, tunable). */
export const PACING_MULTIPLIERS: Readonly<Record<string, number>> = {
  measured: 0.96,
  brisk: 1.04,
  dynamic: 1.06,
};

// ---------------------------------------------------------------------------
// Surface template packs
// ---------------------------------------------------------------------------

/**
 * Conversational families the realizer templates are keyed by. Families are
 * broader than enriched tags: e.g. `statement` covers explanation/assessment/
 * points_of_agreement, `question` covers question/follow_up/cross_examination.
 */
export type TagFamily =
  | 'statement'
  | 'question'
  | 'example'
  | 'framing'
  | 'transition'
  | 'connection'
  | 'synthesis'
  | 'conclusion'
  | 'verdict'
  | 'clarification'
  | 'rebuttal'
  | 'position'
  | 'concession'
  | 'interjection';

/** Families that realize their anchors as a question (with a question tail). */
export const QUESTION_FAMILIES: ReadonlySet<TagFamily> = new Set<TagFamily>(['question']);

// ---------------------------------------------------------------------------
// Enumeration spine (C-10 monologic brief, EV-009 LAB-02)
// ---------------------------------------------------------------------------

/**
 * C-10 (v2 contract wave, ruling 2026-09-29; EV-009 LAB-02): the real Brief
 * is a SINGLE narrator with enumerated structure — First/Second/…/Finally
 * (93.92 s single-voice, OBSERVED on the same source; the strongest
 * product-truth delta in the register). A mode declares the families whose
 * turns form the enumeration spine; the realizer opens those turns by
 * POSITION among the spine — NEVER a seeded pick (enumeration ordering is
 * structural product truth, not a stochastic surface). Everything outside
 * the spine keeps the C-5 seeded picks.
 */
export interface EnumerationSpine {
  /** Tag families whose turns are enumerated, in spoken order. */
  readonly families: readonly TagFamily[];
  /** 1-based ordinal openers (index 0 = position 1): 'First,' 'Second,' … */
  readonly ordinalOpeners: readonly string[];
  /** Opener for the LAST spine turn regardless of count ('Finally,'). */
  readonly finalOpener: string;
}

/** Enriched tag -> template family used by the realizer. */
export const TAG_FAMILY: Readonly<Record<EnrichedTurnTag, TagFamily>> = {
  opening_hook: 'framing',
  agenda: 'framing',
  takeaway: 'conclusion',
  acknowledgement: 'interjection',
  reaction: 'interjection',
  follow_up: 'question',
  recap: 'synthesis',
  framing: 'framing',
  question: 'question',
  explanation: 'statement',
  example: 'example',
  connection: 'connection',
  clarification: 'clarification',
  transition: 'transition',
  synthesis: 'synthesis',
  conclusion: 'conclusion',
  assessment: 'statement',
  limitation: 'statement',
  verdict: 'verdict',
  position_statement: 'position',
  rebuttal: 'rebuttal',
  cross_examination: 'question',
  concession: 'concession',
  points_of_agreement: 'synthesis',
};

const ALL_FAMILIES: readonly TagFamily[] = [
  'statement',
  'question',
  'example',
  'framing',
  'transition',
  'connection',
  'synthesis',
  'conclusion',
  'verdict',
  'clarification',
  'rebuttal',
  'position',
  'concession',
  'interjection',
];

/** Surface text fragments for one family set (language + mode overlay). */
export interface SurfacePack {
  readonly openers: Readonly<Partial<Record<TagFamily, readonly string[]>>>;
  /** Closers for statement-family turns (not question tails). */
  readonly closers: Readonly<Partial<Record<TagFamily, readonly string[]>>>;
  /** Question tails appended to the anchored statement in question turns. */
  readonly questionTails: readonly string[];
  /** Connectors joining multiple grounded anchors inside one turn. */
  readonly anchorConnectors: readonly string[];
  /** Prefixes acknowledging the previous speaker's question. */
  readonly acknowledgePrefixes: readonly string[];
  /** Prefixes continuing the same speaker's previous turn. */
  readonly continuationPrefixes: readonly string[];
  /** Intros for evidence-quote expansions ("as the source puts it: …"). */
  readonly evidenceIntros: readonly string[];
}

/** Deep-merge a mode overlay onto a base pack (arrays replace per family). */
export function overlayPack(base: SurfacePack, overlay: Partial<SurfacePack>): SurfacePack {
  return {
    openers: { ...base.openers, ...overlay.openers },
    closers: { ...base.closers, ...overlay.closers },
    questionTails: overlay.questionTails ?? base.questionTails,
    anchorConnectors: overlay.anchorConnectors ?? base.anchorConnectors,
    acknowledgePrefixes: overlay.acknowledgePrefixes ?? base.acknowledgePrefixes,
    continuationPrefixes: overlay.continuationPrefixes ?? base.continuationPrefixes,
    evidenceIntros: overlay.evidenceIntros ?? base.evidenceIntros,
  };
}

/** All families — used by pack completeness checks in tests. */
export const ALL_TAG_FAMILIES: readonly TagFamily[] = ALL_FAMILIES;

// ---------------------------------------------------------------------------
// Enriched-tag and stance derivation rules
// ---------------------------------------------------------------------------

export interface EnrichedTagRule {
  readonly tag: EnrichedTurnTag;
  /** The rule only fires when the turn's frozen purpose matches. */
  readonly purpose: AudioTurnPurpose;
  /** Deterministic pattern over the turn brief (case-insensitive). */
  readonly pattern: RegExp;
}

export interface StanceRule {
  readonly stance: SpeakerStance;
  readonly pattern: RegExp;
}

// ---------------------------------------------------------------------------
// Mode-semantics QA expectations
// ---------------------------------------------------------------------------

export interface ModeQaExpectations {
  /**
   * Enriched tags expected in a plan of sufficient size (>= minTurns); their
   * absence is a `mode-semantics-missing` warning against the plan (feedback
   * to the Director — structure is plan-authoritative, §16.2 items 1–2).
   */
  readonly expectedEnriched: readonly { readonly tag: EnrichedTurnTag; readonly minTurns: number }[];
  /** Frozen purposes whose presence is notable for this mode. */
  readonly discouragedPurposes: readonly {
    readonly purpose: AudioTurnPurpose;
    readonly severity: 'info' | 'warning';
    readonly note: string;
  }[];
}

// ---------------------------------------------------------------------------
// Mode profile
// ---------------------------------------------------------------------------

/** Everything mode-conditioned the compiler needs. */
export interface ModeProfile {
  readonly mode: 'deep-dive' | 'brief' | 'critique' | 'debate';
  readonly rate: RateModel;
  /** Gap-policy scale (DESIGN.md §4.2: Brief gaps shorter). */
  readonly gapScale: number;
  /**
   * C-10 (EV-009 LAB-02): true for single-voice modes (brief). Declares the
   * mode's skeleton monologic BY DESIGN — the dialogic turn-taking QA
   * predicates (speaker parity, alternation runs, same-speaker runs,
   * question→answer links, backchannel presence; H-A-04) do not apply and
   * the realizer suppresses conversational tissue (acknowledgement /
   * continuation prefixes): the enumeration spine is the connective device.
   */
  readonly monologic?: boolean;
  /** C-10: enumeration spine (brief: the statement family, First/…/Finally). */
  readonly enumeration?: EnumerationSpine;
  readonly enrichedRules: readonly EnrichedTagRule[];
  readonly stanceRules: readonly StanceRule[];
  /** Template overlay applied over the language base pack. */
  readonly surfaceOverlay: Partial<SurfacePack>;
  readonly qa: ModeQaExpectations;
}

/** Pick the enriched tag for a turn: rules first (deterministic order), else purpose passthrough. */
export function deriveEnrichedTag(
  profile: ModeProfile,
  purpose: AudioTurnPurpose,
  brief: string,
): EnrichedTurnTag {
  for (const rule of profile.enrichedRules) {
    if (rule.purpose === purpose && rule.pattern.test(brief)) {
      return rule.tag;
    }
  }
  // Passthrough: the frozen purpose IS an enriched tag for the content family.
  return purpose as EnrichedTurnTag;
}

/** Pick a turn stance from brief content (debate only; HYPOTHESIS-grade). */
export function deriveStance(
  profile: ModeProfile,
  brief: string,
  fallback: SpeakerStance = 'neutral',
): SpeakerStance {
  for (const rule of profile.stanceRules) {
    if (rule.pattern.test(brief)) {
      return rule.stance;
    }
  }
  return fallback;
}
