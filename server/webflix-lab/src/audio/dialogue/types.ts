/**
 * Audio pipeline (WFLX-W2, Stage 2) — DialogueGraph types.
 *
 * The DialogueGraph is W2's audio-side intermediate representation: a working,
 * validation and realization view BUILT FROM the plan's authoritative
 * `audioTurns` (src/contracts/overview-plan.ts). Per DESIGN.md §16.2 item 1,
 * W2 does not add, drop, reorder or re-assign turns — the graph enriches the
 * frozen skeleton with:
 *   - enriched conversational tags (§16.2 item 5) that map back onto the
 *     frozen `AudioTurnPurpose` without rewriting contract data,
 *   - derived conversational links (respondsTo / acknowledges),
 *   - section roles derived from the plan's beats,
 *   - personas with voice profiles (§16.2 item 7).
 *
 * It is NOT a shared contract and never leaves src/audio except through the
 * public compiler API for lab inspection and tests.
 */

import type {
  AudioTurnPurpose,
  ClaimRecord,
  EvidenceSpan,
  Id,
  NarrativeBeat,
  OverviewPlan,
  SpeakerRole,
  TurnStyle,
} from '../../contracts';

// ---------------------------------------------------------------------------
// Enriched turn taxonomy (DESIGN.md §3.1, §16.2 item 5)
// ---------------------------------------------------------------------------

/**
 * W2's richer internal turn taxonomy. Every enriched tag maps back onto
 * exactly one frozen `AudioTurnPurpose` per DESIGN.md §16.2 item 5; the
 * frozen purpose always passes through to the output contract unchanged.
 */
export type EnrichedTurnTag =
  // structural enrichment (map to framing / conclusion)
  | 'opening_hook'
  | 'agenda'
  | 'takeaway'
  // conversational enrichment (map to interjection / question / synthesis)
  | 'acknowledgement'
  | 'reaction'
  | 'follow_up'
  | 'recap'
  // content (identical to frozen purposes)
  | 'framing'
  | 'question'
  | 'explanation'
  | 'example'
  | 'connection'
  | 'clarification'
  | 'transition'
  | 'synthesis'
  | 'conclusion'
  // critique (map to explanation / conclusion in the frozen enum)
  | 'assessment'
  | 'limitation'
  | 'verdict'
  // debate (map to framing / clarification / question)
  | 'position_statement'
  | 'rebuttal'
  | 'cross_examination'
  | 'concession'
  // jointly stated uncontested core (maps to synthesis)
  | 'points_of_agreement';

/** Enriched tag -> frozen purpose projection (DESIGN.md §16.2 item 5). */
export const ENRICHED_TAG_TO_PURPOSE: Readonly<Record<EnrichedTurnTag, AudioTurnPurpose>> = {
  opening_hook: 'framing',
  agenda: 'framing',
  takeaway: 'conclusion',
  acknowledgement: 'interjection',
  reaction: 'interjection',
  follow_up: 'question',
  recap: 'synthesis',
  framing: 'framing',
  question: 'question',
  explanation: 'explanation',
  example: 'example',
  connection: 'connection',
  clarification: 'clarification',
  transition: 'transition',
  synthesis: 'synthesis',
  conclusion: 'conclusion',
  assessment: 'explanation',
  limitation: 'explanation',
  verdict: 'conclusion',
  position_statement: 'framing',
  rebuttal: 'clarification',
  cross_examination: 'question',
  concession: 'clarification',
  points_of_agreement: 'synthesis',
};

/**
 * Purposes that may carry zero plan claims: structural and conversational
 * tissue only (DESIGN.md §3.2 grounding rule, expressed in frozen-enum
 * terms). Every other (factual) purpose requires at least one claim id that
 * exists in the plan's graph — enforced by graph validation, not convention.
 */
export const ZERO_CLAIM_ALLOWED_PURPOSES: ReadonlySet<AudioTurnPurpose> = new Set<
  AudioTurnPurpose
>(['framing', 'question', 'interjection', 'transition', 'synthesis', 'conclusion']);

/** Debate stance for a speaker persona (HYPOTHESIS-grade derivation, §16.4 item 1). */
export type SpeakerStance = 'pro' | 'con' | 'neutral';

// ---------------------------------------------------------------------------
// Personas
// ---------------------------------------------------------------------------

/**
 * Lab host persona. Display names are LAB personas ("Ava"/"Ben"), never
 * product voice names (DESIGN.md §3.3). `speakerRole` is the plan's
 * authoritative role; the persona adds voice and conversational bias only.
 */
export interface SpeakerPersona {
  readonly speakerRole: SpeakerRole;
  readonly displayName: string;
  /** Default conversational stance (guide asks, analyst explains). */
  readonly roleBias: 'guide' | 'analyst';
  /** Debate-only stance; derived heuristically from brief content. */
  readonly stance: SpeakerStance;
  /** Voice profile handed to the speech provider port. */
  readonly voice: {
    readonly voice: string;
    readonly rate: number;
    readonly pitch: number;
    readonly volume: number;
    readonly styleTags: readonly string[];
  };
}

// ---------------------------------------------------------------------------
// Links and sections
// ---------------------------------------------------------------------------

/** Typed conversational links for one turn (DESIGN.md §3, links column). */
export interface DialogueLinks {
  /** Turn ids this turn answers (question -> answer, position -> rebuttal). */
  readonly respondsTo: readonly string[];
  /** Turn ids this backchannel/interjection acknowledges. */
  readonly acknowledges: readonly string[];
}

/** Section placement derived from the plan's beats (plan-authoritative). */
export interface DialogueSection {
  readonly beatId: Id | undefined;
  readonly role: 'opening' | 'body' | 'closing';
}

// ---------------------------------------------------------------------------
// Graph nodes and graph
// ---------------------------------------------------------------------------

/** One enriched turn node in the dialogue graph. */
export interface DialogueTurn {
  /** Plan-authoritative turn id (never renumbered by W2). */
  readonly id: Id;
  readonly index: number;
  readonly speakerRole: SpeakerRole;
  /** Frozen plan purpose — passes through unchanged. */
  readonly purpose: AudioTurnPurpose;
  /** W2 enrichment tag; maps back onto `purpose` via ENRICHED_TAG_TO_PURPOSE. */
  readonly enrichedTag: EnrichedTurnTag;
  /** Plan-level directive (authoritative realization guidance). */
  readonly brief: string;
  /** Grounded claim ids (validated to exist in the graph). */
  readonly claimIds: readonly Id[];
  /** Evidence spans from the plan turn. */
  readonly evidence: readonly EvidenceSpan[];
  readonly beatId: Id | undefined;
  readonly section: DialogueSection;
  readonly style: TurnStyle;
  /** Plan-authoritative target duration (seconds). */
  readonly targetDurationSeconds: number;
  /** Rate-model word budget for realization (DESIGN.md §16.2 item 3). */
  readonly estimatedWords: number;
  /** Union of topic ids reached through this turn's claims (or its beat). */
  readonly topicIds: readonly Id[];
  readonly links: DialogueLinks;
  /** Debate stance for THIS turn (HYPOTHESIS-grade; 'neutral' outside debate). */
  readonly stance: SpeakerStance;
}

/** Graph-level metadata binding the graph to its exact plan input. */
export interface DialogueGraphMeta {
  readonly planId: Id;
  /** SHA-256 of the canonical JSON serialization of the plan. */
  readonly planHash: string;
  readonly mode: OverviewPlan['mode'];
  readonly language: string;
  readonly targetDurationSeconds: number;
  readonly seed: string;
}

/** The dialogue graph: personas + turns in spoken (plan) order. */
export interface DialogueGraph {
  readonly meta: DialogueGraphMeta;
  readonly personas: readonly SpeakerPersona[];
  readonly turns: readonly DialogueTurn[];
}

// ---------------------------------------------------------------------------
// Claim lookup context handed through the pipeline
// ---------------------------------------------------------------------------

/** Claim statements by id — the grounding anchor for text realization. */
export type ClaimIndex = ReadonlyMap<Id, ClaimRecord>;

/** Beat lookup by id. */
export type BeatIndex = ReadonlyMap<Id, NarrativeBeat>;
