/**
 * Overview Director (WFLX-W1, Stage 2) — the OverviewPlan compiler.
 *
 * SourceArtifact(s) + SemanticGraph + target parameters -> grounded
 * narrative plan (beats, coverage map, plan-level AudioTurn[] or
 * VideoScene[]).
 *
 * Deterministic and seeded: identical inputs + seed produce byte-identical
 * plans. The seed affects (only) tie-breaking among equal-salience claims
 * and motion/transition pattern offsets — never the grounding rules.
 *
 * Editorial invariants (HYPOTHESIS-labeled lab policies, testable against
 * the real product via the experiment matrix):
 * - Claim selection is budget-driven (duration / secondsPerClaim) and
 *   salience-ranked; custom instructions NEVER change claim coverage
 *   (EXP-V-03 falsifier anchor: they only affect style fields).
 * - Every selected or skipped claim is editorially accounted for in the
 *   coverage map (covered with role, or omitted with reason).
 * - Exact labels for deterministic scenes come from grounded entity names.
 * - Turn-budget allocation is anchor-mass-aware (EV-005 fix): a turn slot
 *   only cites claims its duration can voice at TURN_PLANNING_RATE_WPS
 *   (below every audio mode rate ceiling), factual carrier slots always
 *   cite at least one claim, and every covered claim is voiced by at least
 *   one turn. When a degenerate beat budget cannot voice its claims, the
 *   plan-level duration budget wins and the audio compiler flags the
 *   residual honestly (never a silent drop).
 *
 * The Director owns editorial decisions only — no speech, images or video
 * generation (AGENTS.md architecture rule).
 */

import {
  ANCHOR_CONNECTOR_TOKENS,
  CONTRACTS_VERSION,
  countWords,
  FACTUAL_TURN_PURPOSES,
  MIN_TURN_SECONDS,
  OverviewPlanSchema,
  QUESTION_TAIL_TOKENS,
  TOPICAL_TISSUE_TOKENS,
  TURN_PLANNING_RATE_WPS,
  validateOverviewPlan,
  type AudioTurn,
  type AudioTurnPurpose,
  type AudienceLevel,
  type ClaimRecord,
  type EntityRecord,
  type Id,
  type NarrativeBeat,
  type OverviewMode,
  type OverviewModality,
  type OverviewPlan,
  type RelationshipRecord,
  type SceneTextItem,
  type SemanticGraph,
  type SourceArtifact,
  type SpeakerRole,
  type UtcTimestamp,
  type VideoScene,
} from '../contracts';
import { GraphIndex } from '../source/graph/retrieval';

export const DIRECTOR_ID = 'OverviewDirector@0.1.0';

/** Editorial prior: seconds of overview per claim at full coverage (HYPOTHESIS). */
export const DEFAULT_SECONDS_PER_CLAIM = 27;

export interface DirectorRequest {
  sources: readonly SourceArtifact[];
  graph: SemanticGraph;
  modality: OverviewModality;
  /** Defaults: audio -> deep-dive, video -> explainer. */
  mode?: OverviewMode;
  /** Default 'technical'. */
  audience?: AudienceLevel;
  /** Default 'en'. */
  language?: string;
  targetDurationSeconds: number;
  /** Custom instructions affect style fields only, never claim coverage. */
  customInstructions?: string;
  /** Deterministic seed; required. */
  seed: string;
  /** Plan createdAt. Supply a fixed value for reproducibility. */
  now?: UtcTimestamp;
  styleBibleId?: Id;
  /** Plan id override; derived deterministically when omitted. */
  planId?: string;
  /** Editorial prior override (seconds per claim). */
  secondsPerClaim?: number;
}

export class DirectorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DirectorError';
  }
}

// ---------------------------------------------------------------------------
// Seeded determinism
// ---------------------------------------------------------------------------

function hashSeed(seed: string): number {
  let h = 2166136261;
  for (const ch of seed) {
    h ^= ch.codePointAt(0) ?? 0;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(a: number): () => number {
  let state = a;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable rank: salience desc; equal-salience groups are seed-shuffled. */
function rankedClaimIds(graph: SemanticGraph, rand: () => number): Id[] {
  const groups = new Map<number, ClaimRecord[]>();
  for (const claim of graph.claims) {
    const list = groups.get(claim.salience) ?? [];
    list.push(claim);
    groups.set(claim.salience, list);
  }
  const out: Id[] = [];
  for (const salience of [...groups.keys()].sort((a, b) => b - a)) {
    const group = (groups.get(salience) as ClaimRecord[]).slice();
    // Fisher-Yates with the seeded PRNG.
    for (let i = group.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rand() * (i + 1));
      const tmp = group[i] as ClaimRecord;
      group[i] = group[j] as ClaimRecord;
      group[j] = tmp;
    }
    out.push(...group.map((c) => c.id));
  }
  return out;
}

/** Split a total into integer shares by weights (largest-remainder method). */
function splitInteger(total: number, weights: number[], minimum: number): number[] {
  if (weights.length === 0) return [];
  const sum = weights.reduce((a, b) => a + b, 0);
  const w = sum === 0 ? weights.map(() => 1) : weights;
  const wSum = w.reduce((a, b) => a + b, 0);
  const raw = w.map((x) => (total * x) / wSum);
  const base = raw.map((x) => Math.max(minimum, Math.floor(x)));
  // If minimums overdraw the budget, take back from the largest buckets.
  let over = base.reduce((a, b) => a + b, 0) - total;
  while (over > 0) {
    let maxIdx = 0;
    for (let i = 1; i < base.length; i += 1) {
      if ((base[i] as number) > (base[maxIdx] as number)) maxIdx = i;
    }
    if ((base[maxIdx] as number) <= minimum) break;
    base[maxIdx] = (base[maxIdx] as number) - 1;
    over -= 1;
  }
  let remainder = total - base.reduce((a, b) => a + b, 0);
  // Redistribute any remainder to the largest fractional parts.
  const order = raw
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac);
  let k = 0;
  while (remainder > 0 && order.length > 0) {
    const target = order[k % order.length] as { i: number };
    base[target.i] = (base[target.i] as number) + 1;
    remainder -= 1;
    k += 1;
  }
  return base;
}

// ---------------------------------------------------------------------------
// Turn-budget allocation (EV-005 fix, WFLX-P3A: anchor mass vs slot duration)
// ---------------------------------------------------------------------------

/*
 * C-7 (v2 contract wave, ruling 2026-09-29): the rate model moved to the
 * shared contracts — ONE authoritative surface consumed by the Director and
 * (per ruling) the audio surface (EV-008 mirror-risk evidence, LAB-03/EV-009
 * product truth). Values are IDENTICAL to the Director-local constants they
 * replace, so this move alone produces ZERO output change. The Director
 * re-exports TURN_PLANNING_RATE_WPS for API stability (tests/director and
 * EV-008 cite it through this module path).
 */
export {
  ANCHOR_CONNECTOR_TOKENS,
  FACTUAL_TURN_PURPOSES,
  MIN_TURN_SECONDS,
  QUESTION_TAIL_TOKENS,
  TOPICAL_TISSUE_TOKENS,
  TURN_PLANNING_RATE_WPS,
};

/**
 * Split an integer total across slots by proportional keys with per-slot
 * minimum floors (largest-remainder method, deterministic index tie-break).
 * When the floors overdraw the total, returns a plain key-proportional split
 * with the uniform minimum instead — the plan-level budget invariant (turn
 * durations sum to the target) outranks per-slot mass fit, and the audio
 * compiler honestly flags any residual over-budget turn (pre-fix behavior at
 * degenerate targets).
 */
function splitIntegerWithFloors(
  total: number,
  keys: readonly number[],
  floors: readonly number[],
  minimum: number,
): number[] {
  const floorSum = floors.reduce((a, b) => a + b, 0);
  if (floorSum > total) {
    return splitInteger(
      total,
      keys.map((k) => Math.max(1, k)),
      minimum,
    );
  }
  const base = floors.map((f) => Math.max(minimum, f));
  let remaining = total - base.reduce((a, b) => a + b, 0);
  const keySum = keys.reduce((a, b) => a + b, 0);
  const raw = keys.map((k) => (keySum > 0 ? (remaining * k) / keySum : remaining / keys.length));
  const ints = raw.map((x) => Math.floor(x));
  ints.forEach((add, i) => {
    base[i] = (base[i] as number) + add;
  });
  remaining -= ints.reduce((a, b) => a + b, 0);
  const order = raw
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  let k = 0;
  while (remaining > 0 && order.length > 0) {
    const target = order[k % order.length] as { i: number };
    base[target.i] = (base[target.i] as number) + 1;
    remaining -= 1;
    k += 1;
  }
  return base;
}

interface TurnBudgetCandidate {
  readonly slots: readonly TurnSlot[];
  /** Claims each slot cites (factual carriers first; structural slots may be claim-less). */
  readonly assigned: Id[][];
  /** Minimum seconds each slot needs to voice its mandatory mass at the planning rate. */
  readonly floors: number[];
  /** Key-proportional split weights (anchor mass + tissue allowance). */
  readonly keys: number[];
  readonly floorSum: number;
}

// ---------------------------------------------------------------------------
// Mode profiles (HYPOTHESIS: speaker counts and purpose patterns per mode)
// ---------------------------------------------------------------------------

interface TurnSlot {
  role: SpeakerRole;
  purpose: AudioTurnPurpose;
}

interface ModeProfile {
  speakers: number;
  tone: string;
  opening: TurnSlot[];
  perBeat: TurnSlot[];
  closing: TurnSlot[];
}

const A: TurnSlot = { role: 'host-a', purpose: 'framing' };
const B_EXPLAIN: TurnSlot = { role: 'host-b', purpose: 'explanation' };

/**
 * C-10 narrator slots (v2 contract wave, ruling 2026-09-29; EV-009 LAB-02):
 * the real Brief is a SINGLE narrator with enumerated structure
 * (First/Second/Finally; 93.92 s single-voice, OBSERVED on the same source
 * vs our v1 fixed 10-turn two-speaker dialog at 120 s) — the strongest
 * product-truth delta in the register. The SpeakerRole 'narrator' already
 * exists in the v1 contracts enum; no contracts change for the role.
 */
const NARRATOR_FRAMING: TurnSlot = { role: 'narrator', purpose: 'framing' };
const NARRATOR_EXPLANATION: TurnSlot = { role: 'narrator', purpose: 'explanation' };
const NARRATOR_CONCLUSION: TurnSlot = { role: 'narrator', purpose: 'conclusion' };

const MODE_PROFILES: Record<string, ModeProfile> = {
  'deep-dive': {
    speakers: 2,
    tone: 'curious, expert, conversational',
    opening: [A, B_EXPLAIN],
    perBeat: [
      A,
      B_EXPLAIN,
      { role: 'host-a', purpose: 'question' },
      { role: 'host-b', purpose: 'example' },
    ],
    closing: [
      { role: 'host-a', purpose: 'synthesis' },
      B_EXPLAIN,
      { role: 'host-a', purpose: 'conclusion' },
    ],
  },
  brief: {
    // C-10 (EV-009 LAB-02): monologic skeleton — 1 speaker, ALL turns
    // SpeakerRole 'narrator'; narrator framing sign-on, ONE explanation turn
    // per topic beat (the single carrier voices every beat claim), narrator
    // conclusion. Beat coverage preserved (H-A-01): every beat still voiced.
    // Brief register: no agenda, no connection tissue, no examples unless
    // plan-essential.
    speakers: 1,
    tone: 'crisp, high-signal',
    opening: [NARRATOR_FRAMING],
    perBeat: [NARRATOR_EXPLANATION],
    closing: [NARRATOR_CONCLUSION],
  },
  critique: {
    speakers: 2,
    tone: 'rigorous, fair, constructively critical',
    opening: [A, B_EXPLAIN],
    perBeat: [
      A,
      B_EXPLAIN,
      { role: 'host-a', purpose: 'question' },
      { role: 'host-b', purpose: 'clarification' },
    ],
    closing: [
      { role: 'host-a', purpose: 'synthesis' },
      { role: 'host-b', purpose: 'conclusion' },
    ],
  },
  debate: {
    speakers: 2,
    tone: 'spiky but good-faith, contrast-driven',
    opening: [A, B_EXPLAIN],
    perBeat: [
      A,
      { role: 'host-b', purpose: 'question' },
      B_EXPLAIN,
      { role: 'host-a', purpose: 'clarification' },
    ],
    closing: [
      { role: 'host-a', purpose: 'synthesis' },
      { role: 'host-b', purpose: 'conclusion' },
    ],
  },
  explainer: {
    speakers: 1,
    tone: 'clear, technical, quietly enthusiastic',
    opening: [A],
    perBeat: [A, B_EXPLAIN],
    closing: [A],
  },
  short: {
    speakers: 1,
    tone: 'punchy, immediate',
    opening: [A],
    perBeat: [A],
    closing: [A],
  },
  cinematic: {
    speakers: 1,
    tone: 'cinematic, deliberate',
    opening: [A],
    perBeat: [A, B_EXPLAIN],
    closing: [A],
  },
};

/** Display names per SpeakerRole (C-10: 'narrator' -> 'Narrator'). */
const SPEAKER_NAMES: Readonly<Record<SpeakerRole, string>> = {
  'host-a': 'Host A',
  'host-b': 'Host B',
  guest: 'Guest',
  narrator: 'Narrator',
};

const PURPOSE_DELIVERY: Record<AudioTurnPurpose, string> = {
  framing: 'warm, orienting',
  question: 'curious, conversational',
  explanation: 'clear, expert, unhurried',
  example: 'energetic, concrete',
  connection: 'recollected, linking',
  clarification: 'patient, precise',
  interjection: 'light, engaged',
  transition: 'light, forward-moving',
  synthesis: 'reflective, tying together',
  conclusion: 'resolved, landing',
};

const PURPOSE_LEAD: Record<AudioTurnPurpose, string> = {
  framing: 'Open the segment and orient the listener.',
  question: "Put the listener's question.",
  explanation: 'Explain, grounded in the source.',
  example: 'Give a concrete example from the source.',
  connection: 'Connect back to the earlier segments.',
  clarification: 'Clarify the likely confusion precisely.',
  interjection: 'React briefly.',
  transition: 'Bridge to the next segment.',
  synthesis: 'Synthesize the thread so far.',
  conclusion: 'Land the closing takeaway.',
};

// ---------------------------------------------------------------------------
// Scene typing rules (reference scene atlas)
// ---------------------------------------------------------------------------

const DETERMINISTIC_TYPES = new Set([
  'title-card',
  'table',
  'callout',
  'quote-panel',
  'architecture-diagram',
  'state-diagram',
  'process-flow',
  'data-chart',
  'code-panel',
]);

const MOTION_BY_TYPE: Record<string, VideoScene['motion']> = {
  'title-card': 'static',
  table: 'pan',
  callout: 'static',
  'quote-panel': 'static',
  'architecture-diagram': 'animated-diagram',
  'state-diagram': 'animated-diagram',
  'process-flow': 'animated-diagram',
  'data-chart': 'animated-diagram',
  'code-panel': 'static',
  'hero-illustration': 'zoom',
  'metaphor-illustration': 'pan',
  'workstation-scene': 'pan',
  montage: 'pan',
};

// ---------------------------------------------------------------------------
// Compilation
// ---------------------------------------------------------------------------

function statementsOf(index: GraphIndex, claimIds: readonly Id[], cap = 900): string {
  const picked = claimIds
    .map((id) => index.getClaim(id)?.statement)
    .filter((s): s is string => s !== undefined);
  const joined = picked.length > 0 ? picked.join(' ') : 'the source as a whole.';
  return joined.length > cap ? `${joined.slice(0, cap - 3)}...` : joined;
}

function entityNamesOf(index: GraphIndex, claimIds: readonly Id[], cap: number): string[] {
  const names: string[] = [];
  for (const claimId of claimIds) {
    for (const entity of index.entitiesInClaim(claimId)) {
      if (!names.includes(entity.name)) names.push(entity.name);
    }
  }
  return names.slice(0, cap);
}

function roleOf(salience: number): 'primary' | 'supporting' | 'mention' {
  if (salience >= 0.8) return 'primary';
  if (salience >= 0.5) return 'supporting';
  return 'mention';
}

export function compileOverviewPlan(request: DirectorRequest): OverviewPlan {
  const {
    sources,
    graph,
    modality,
    targetDurationSeconds,
    seed,
  } = request;
  if (sources.length === 0) throw new DirectorError('Director requires at least one source');
  if (!Number.isFinite(targetDurationSeconds) || targetDurationSeconds <= 0) {
    throw new DirectorError('targetDurationSeconds must be positive');
  }
  const index = new GraphIndex(graph, sources);
  if (graph.claims.length === 0) throw new DirectorError('graph has no claims to plan from');

  const mode: OverviewMode =
    request.mode ?? (modality === 'audio' ? 'deep-dive' : 'explainer');
  const profile = MODE_PROFILES[mode];
  if (profile === undefined) throw new DirectorError(`no mode profile for ${mode}`);
  const isAudioMode = ['deep-dive', 'brief', 'critique', 'debate'].includes(mode);
  if (modality === 'audio' && !isAudioMode) {
    throw new DirectorError(`mode ${mode} is not an audio mode`);
  }
  if (modality === 'video' && isAudioMode) {
    throw new DirectorError(`mode ${mode} is not a video mode`);
  }

  const rand = mulberry32(hashSeed(seed));
  const now: UtcTimestamp =
    request.now ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const secondsPerClaim = request.secondsPerClaim ?? DEFAULT_SECONDS_PER_CLAIM;
  const audience: AudienceLevel = request.audience ?? 'technical';
  const language = request.language ?? 'en';
  const primarySource = sources[0] as SourceArtifact;
  const sourceTitle = primarySource.title;

  // --- claim selection (budget-driven; custom instructions never affect it)
  const rankedIds = rankedClaimIds(graph, rand);
  const capacity = Math.max(1, Math.min(graph.claims.length, Math.ceil(targetDurationSeconds / secondsPerClaim)));
  const selectedIds = rankedIds.slice(0, capacity);
  const selectedSet = new Set(selectedIds);

  // --- grouping by topic
  const topics = [...graph.topics].sort((a, b) =>
    b.salience - a.salience !== 0 ? b.salience - a.salience : a.id.localeCompare(b.id),
  );
  const claimsByTopic = new Map<Id, Id[]>();
  for (const claimId of selectedIds) {
    const claim = index.getClaim(claimId);
    const topicId = claim?.topicIds[0];
    if (topicId === undefined) continue; // covered via the unit fallback below
    const list = claimsByTopic.get(topicId) ?? [];
    list.push(claimId);
    claimsByTopic.set(topicId, list);
  }
  const topicBeats = topics.filter((t) => (claimsByTopic.get(t.id) ?? []).length > 0);

  const goalClaim =
    graph.claims.find((c) => c.kind === 'goal') ?? index.getClaim(selectedIds[0] as Id);
  if (goalClaim === undefined) throw new DirectorError('no anchor claim available');

  // --- beats and budget
  interface BeatDraft {
    key: string;
    title: string;
    purpose: string;
    claimIds: Id[];
    topicIds: readonly Id[];
    weightHint: number;
    slots: TurnSlot[];
  }
  const beatDrafts: BeatDraft[] = [];
  beatDrafts.push({
    key: 'opening',
    title: 'Opening',
    purpose: `Frame the overview and orient the ${audience} audience on ${sourceTitle}.`,
    claimIds: [goalClaim.id],
    topicIds: goalClaim.topicIds,
    weightHint: 1,
    slots: profile.opening,
  });
  for (const topic of topicBeats) {
    const claimIds = claimsByTopic.get(topic.id) ?? [];
    beatDrafts.push({
      key: `topic-${topic.id}`,
      title: topic.title,
      purpose: `Cover the ${topic.title} material selected for this plan.`,
      claimIds,
      topicIds: [topic.id],
      weightHint: claimIds.length,
      slots: profile.perBeat,
    });
  }
  beatDrafts.push({
    key: 'closing',
    title: 'Takeaways',
    purpose: 'Synthesize the covered claims into closing takeaways.',
    claimIds: [goalClaim.id],
    topicIds: goalClaim.topicIds,
    weightHint: 1,
    slots: profile.closing,
  });

  // Opening/closing get 10% each (absolute); topic beats share the rest
  // proportionally to claim mass.
  const openingClosing = Math.max(2, Math.round(targetDurationSeconds * 0.1));
  const topicPool = Math.max(1, targetDurationSeconds - 2 * openingClosing);
  const topicBudgets = splitInteger(
    topicPool,
    beatDrafts.filter((b) => b.key.startsWith('topic-')).map((b) => b.weightHint),
    2,
  );
  let topicBudgetIdx = 0;
  const budgets = beatDrafts.map((draft) => {
    if (draft.key === 'opening' || draft.key === 'closing') return openingClosing;
    const budget = topicBudgets[topicBudgetIdx] as number | undefined;
    topicBudgetIdx += 1;
    return budget ?? topicPool;
  });

  const beats: NarrativeBeat[] = beatDrafts.map((draft, i) => ({
    id: `beat-${i + 1}`,
    index: i,
    title: draft.title,
    purpose: draft.purpose,
    brief: `${draft.purpose} Stay grounded on: ${statementsOf(index, draft.claimIds)}`,
    claimIds: draft.claimIds,
    topicIds: draft.topicIds,
    weight: Math.round(((budgets[i] as number) / targetDurationSeconds) * 10000) / 10000,
  }));

  // --- audio turns (turn-budget allocation, EV-005 fix: anchor mass vs slot
  // duration within the mode rate ceiling; see TURN_PLANNING_RATE_WPS)
  const audioTurns: AudioTurn[] = [];
  if (modality === 'audio') {
    let turnNo = 0;
    beatDrafts.forEach((draft, beatIndex) => {
      const beat = beats[beatIndex];
      if (beat === undefined) throw new DirectorError('missing beat');
      const budget = budgets[beatIndex] as number;

      const claimMass = new Map<Id, number>();
      for (const claimId of draft.claimIds) {
        claimMass.set(claimId, countWords(index.getClaim(claimId)?.statement ?? ''));
      }
      const titleTokens = countWords(draft.title);

      /**
       * Build the allocation candidate for one prefix of the mode pattern:
       * claims are load-balanced (heaviest first onto the lightest factual
       * carrier) so no carrier holds more mass than its siblings; factual
       * slots must each carry >= 1 claim when the beat has claims (audio
       * grounding rule), structural slots are claim-less topical tissue.
       *
       * `softStructural` relaxes structural-slot floors to the bare minimum
       * (second-chance pass for squeezed beats): the factual carrier's
       * anchor-mass floor stays hard, conversational tissue shrinks first.
       */
      const buildCandidate = (
        slots: readonly TurnSlot[],
        softStructural = false,
      ): TurnBudgetCandidate | null => {
        const factualIdx: number[] = [];
        slots.forEach((slot, i) => {
          if (FACTUAL_TURN_PURPOSES.has(slot.purpose)) factualIdx.push(i);
        });
        if (draft.claimIds.length > 0 && factualIdx.length === 0) return null;
        if (factualIdx.length > draft.claimIds.length) return null;

        const assigned: Id[][] = slots.map(() => []);
        const loads = new Map<number, number>();
        // Heaviest-claim-first (LPT) load balancing; deterministic id
        // tie-break, no RNG.
        const claimsByMass = [...draft.claimIds]
          .sort(
            (a, b) =>
              (claimMass.get(b) ?? 0) - (claimMass.get(a) ?? 0) || a.localeCompare(b),
          );
        for (const claimId of claimsByMass) {
          let target = factualIdx[0] as number;
          let bestLoad = Number.POSITIVE_INFINITY;
          for (const i of factualIdx) {
            const load = loads.get(i) ?? 0;
            if (load < bestLoad) {
              bestLoad = load;
              target = i;
            }
          }
          const list = assigned[target] as Id[];
          list.push(claimId);
          loads.set(
            target,
            (loads.get(target) ?? 0) + (claimMass.get(claimId) ?? 0) + (list.length > 1 ? ANCHOR_CONNECTOR_TOKENS : 0),
          );
        }

        const floors: number[] = [];
        const keys: number[] = [];
        slots.forEach((slot, i) => {
          const isQuestion = slot.purpose === 'question';
          const carried = assigned[i] as Id[];
          const mass =
            carried.length > 0
              ? (loads.get(i) ?? 0) + (isQuestion ? QUESTION_TAIL_TOKENS : 0)
              : titleTokens + TOPICAL_TISSUE_TOKENS + (isQuestion ? QUESTION_TAIL_TOKENS : 0);
          const floor = Math.max(MIN_TURN_SECONDS, Math.ceil(mass / TURN_PLANNING_RATE_WPS));
          const soft = softStructural && carried.length === 0;
          floors.push(soft ? MIN_TURN_SECONDS : floor);
          keys.push(Math.max(1, mass));
        });
        return {
          slots,
          assigned,
          floors,
          keys,
          floorSum: floors.reduce((a, b) => a + b, 0),
        };
      };

      /** Topical fallback: the pattern has no factual slot at any prefix
       * length (single-structural-slot opening/closing patterns); the beat's
       * claims stay beat-covered and are voiced by their topic beats. */
      const buildTopicalCandidate = (slots: readonly TurnSlot[]): TurnBudgetCandidate => {
        const floors: number[] = [];
        const keys: number[] = [];
        for (const slot of slots) {
          const isQuestion = slot.purpose === 'question';
          const mass = titleTokens + TOPICAL_TISSUE_TOKENS + (isQuestion ? QUESTION_TAIL_TOKENS : 0);
          floors.push(Math.max(MIN_TURN_SECONDS, Math.ceil(mass / TURN_PLANNING_RATE_WPS)));
          keys.push(Math.max(1, mass));
        }
        return {
          slots,
          assigned: slots.map(() => []),
          floors,
          keys,
          floorSum: floors.reduce((a, b) => a + b, 0),
        };
      };

      // Slot-count selection, three passes:
      //   1. largest prefix whose hard floors (anchor mass + topical tissue)
      //      fit the beat budget;
      //   2. largest prefix that fits once structural floors relax to the
      //      bare minimum — the factual carrier's anchor-mass floor stays
      //      hard (conversational tissue shrinks before anchors);
      //   3. last resort: largest structurally-valid prefix with a
      //      key-proportional split — the plan-level budget invariant
      //      outranks mass fit and the audio compiler flags any residual
      //      honestly (degenerate targets only, never a silent drop).
      let candidate: TurnBudgetCandidate | null = null;
      let fallback: TurnBudgetCandidate | null = null;
      for (let n = draft.slots.length; n >= 1 && candidate === null; n -= 1) {
        const built = buildCandidate(draft.slots.slice(0, n));
        if (built === null) continue;
        if (fallback === null || built.slots.length > fallback.slots.length) fallback = built;
        if (built.floorSum <= budget) candidate = built;
      }
      for (let n = draft.slots.length; n >= 1 && candidate === null; n -= 1) {
        const built = buildCandidate(draft.slots.slice(0, n), true);
        if (built === null) continue;
        if (built.floorSum <= budget) candidate = built;
      }
      if (candidate === null) candidate = fallback ?? buildTopicalCandidate(draft.slots);

      const slots = candidate.slots;
      const durations = splitIntegerWithFloors(budget, candidate.keys, candidate.floors, MIN_TURN_SECONDS);

      // Structural slots may anchor the beat's lead claim when their slot
      // duration can voice it (the EV-005 defect was anchoring regardless of
      // duration; the fix anchors only where it fits).
      const lead = draft.claimIds[0];
      const leadMass = lead !== undefined ? (claimMass.get(lead) ?? 0) : 0;
      slots.forEach((slot, localIdx) => {
        const carried = candidate.assigned[localIdx] as Id[];
        if (carried.length > 0 || lead === undefined) return;
        const need = Math.max(
          MIN_TURN_SECONDS,
          Math.ceil(
            (leadMass + (slot.purpose === 'question' ? QUESTION_TAIL_TOKENS : 0)) /
              TURN_PLANNING_RATE_WPS,
          ),
        );
        if ((durations[localIdx] as number) >= need) carried.push(lead);
      });

      slots.forEach((slot, localIdx) => {
        turnNo += 1;
        const assigned = candidate.assigned[localIdx] as Id[];
        const evidence = assigned
          .map((id) => index.getClaim(id)?.evidence[0])
          .filter((s): s is NonNullable<typeof s> => s !== undefined)
          .slice(0, 2);
        const names = entityNamesOf(index, assigned, 3).join(', ');
        const anchorDirective =
          assigned.length > 0
            ? `Anchors: ${statementsOf(index, assigned, 500)}`
            : `No claim anchors this turn; stay on the segment topic: ${draft.title}.`;
        audioTurns.push({
          recordType: 'AudioTurn',
          contractVersion: CONTRACTS_VERSION,
          id: `turn-${turnNo}`,
          index: turnNo - 1,
          speaker: SPEAKER_NAMES[slot.role],
          speakerRole: slot.role,
          purpose: slot.purpose,
          brief:
            `${PURPOSE_LEAD[slot.purpose]} ` +
            (slot.purpose === 'question' ? `Focus on ${names || 'the details'}. ` : '') +
            anchorDirective,
          claimIds: assigned,
          evidence,
          beatId: beat.id,
          style: {
            delivery: PURPOSE_DELIVERY[slot.purpose],
            ...(slot.purpose === 'explanation' && names !== ''
              ? { emphasis: `say entity names crisply: ${names}` }
              : {}),
          },
          targetDurationSeconds: (durations[localIdx] as number) || MIN_TURN_SECONDS,
        });
      });
    });
  }

  // --- video scenes
  const videoScenes: VideoScene[] = [];
  if (modality === 'video') {
    const transitionOffset = Math.floor(rand() * 3);
    const transitions: VideoScene['transition'][] = ['cut', 'crossfade', 'morph'];
    let sceneNo = 0;
    beatDrafts.forEach((draft, beatIndex) => {
      const beat = beats[beatIndex];
      if (beat === undefined) throw new DirectorError('missing beat');
      const budget = budgets[beatIndex] as number;
      const maxScenes = Math.max(1, Math.min(3, Math.floor(budget / 12)));

      const beatEntities: EntityRecord[] = [];
      const seen = new Set<Id>();
      for (const claimId of draft.claimIds) {
        for (const entity of index.entitiesInClaim(claimId)) {
          if (!seen.has(entity.id)) {
            seen.add(entity.id);
            beatEntities.push(entity);
          }
        }
      }
      const beatRels: RelationshipRecord[] = graph.relationships.filter((rel) =>
        draft.claimIds.some(
          (claimId) =>
            index.getClaim(claimId)?.entityIds.includes(rel.subjectId) === true ||
            index.getClaim(claimId)?.entityIds.includes(rel.objectId) === true,
        ),
      );
      const hasProcess = beatEntities.some((e) => e.kind === 'process' || e.kind === 'workflow');

      interface SceneDraft {
        visualType: VideoScene['visualType'];
        exactTexts: SceneTextItem[];
        claimIds: Id[];
        visualBrief?: string;
      }
      const sceneDrafts: SceneDraft[] = [];
      if (draft.key === 'opening') {
        sceneDrafts.push({
          visualType: 'title-card',
          exactTexts: [
            { role: 'title', value: sourceTitle.slice(0, 60), exact: true },
            { role: 'caption', value: `a ${mode} overview`, exact: true },
          ],
          claimIds: [draft.claimIds[0] as Id],
        });
        sceneDrafts.push({
          visualType: 'hero-illustration',
          exactTexts: [],
          claimIds: [draft.claimIds[0] as Id],
          visualBrief: 'Hand-drawn ink hero composition on graphite paper with cyan/teal emphasis, per the reference scene atlas.',
        });
      } else if (draft.key === 'closing') {
        sceneDrafts.push({
          visualType: 'hero-illustration',
          exactTexts: entityNamesOf(index, draft.claimIds, 2).map((name) => ({
            role: 'label' as const,
            value: name,
            exact: true,
          })),
          claimIds: [draft.claimIds[0] as Id],
          visualBrief: 'The opening motif resolved into one clean diagram sheet; ink linework, graphite background.',
        });
        sceneDrafts.push({
          visualType: 'title-card',
          exactTexts: [
            { role: 'title', value: 'Takeaways', exact: true },
            { role: 'caption', value: statementsOf(index, draft.claimIds, 60).replace(/\.$/, ''), exact: true },
          ],
          claimIds: [draft.claimIds[0] as Id],
        });
      } else {
        if (beatRels.length > 0 && sceneDrafts.length < maxScenes - 1) {
          const labels: SceneTextItem[] = [];
          for (const rel of beatRels.slice(0, 3)) {
            for (const entityId of [rel.subjectId, rel.objectId]) {
              const name = index.getEntity(entityId)?.name;
              if (name !== undefined && !labels.some((l) => l.value === name)) {
                labels.push({ role: 'label', value: name, exact: true });
              }
            }
          }
          sceneDrafts.push({
            visualType: 'architecture-diagram',
            exactTexts: labels.slice(0, 6),
            claimIds: draft.claimIds.slice(0, 1),
          });
        }
        if (beatEntities.length >= 5 && sceneDrafts.length < maxScenes - 1) {
          sceneDrafts.push({
            visualType: 'table',
            exactTexts: beatEntities.slice(0, 5).map((e) => ({
              role: 'label' as const,
              value: e.name,
              exact: true,
            })),
            claimIds: draft.claimIds.slice(0, 1),
          });
        }
        if (hasProcess && sceneDrafts.length < maxScenes - 1) {
          sceneDrafts.push({
            visualType: 'process-flow',
            exactTexts: beatEntities
              .filter((e) => e.kind === 'process' || e.kind === 'workflow')
              .slice(0, 3)
              .map((e) => ({ role: 'label' as const, value: e.name, exact: true })),
            claimIds: draft.claimIds.slice(-1),
          });
        }
        sceneDrafts.push({
          visualType: 'metaphor-illustration',
          exactTexts: [],
          claimIds: draft.claimIds.slice(-1),
          visualBrief: 'A visual metaphor for this segment; hand-drawn ink linework on graphite paper with cyan/teal emphasis.',
        });
      }

      const capped = sceneDrafts.slice(0, Math.max(1, maxScenes));
      const durations = splitInteger(budget, capped.map(() => 1), 5);
      capped.forEach((sceneDraft, localIdx) => {
        sceneNo += 1;
        const renderingClass = DETERMINISTIC_TYPES.has(sceneDraft.visualType)
          ? 'deterministic'
          : sceneDraft.visualType === 'hero-illustration' && sceneDraft.exactTexts.length > 0
            ? 'hybrid'
            : 'generative';
        videoScenes.push({
          recordType: 'VideoScene',
          contractVersion: CONTRACTS_VERSION,
          id: `scene-${sceneNo}`,
          index: sceneNo - 1,
          beatId: beat.id,
          narrativePurpose: `${draft.title}: ${statementsOf(index, sceneDraft.claimIds, 140)}`,
          visualType: sceneDraft.visualType,
          renderingClass,
          exactTexts: sceneDraft.exactTexts,
          claimIds: sceneDraft.claimIds,
          narrationRef: `narr-s${sceneNo}`,
          narrationBrief: `Narrate the ${draft.title} segment; anchors: ${statementsOf(index, sceneDraft.claimIds, 200)}`,
          targetDurationSeconds: (durations[localIdx] as number) || 5,
          motion: MOTION_BY_TYPE[sceneDraft.visualType] ?? 'static',
          transition: transitions[(sceneNo - 1 + transitionOffset) % 3] as VideoScene['transition'],
          ...(request.styleBibleId !== undefined ? { styleBibleId: request.styleBibleId } : {}),
          ...(sceneDraft.visualBrief !== undefined ? { visualBrief: sceneDraft.visualBrief } : {}),
        });
      });
    });
  }

  // --- coverage map: every graph claim accounted for
  const unitIdsFor = (claimId: Id): string[] => {
    const units = new Set<string>();
    for (const beat of beats) {
      if (beat.claimIds.includes(claimId)) units.add(beat.id);
    }
    for (const turn of audioTurns) {
      if (turn.claimIds.includes(claimId)) units.add(turn.id);
    }
    for (const scene of videoScenes) {
      if (scene.claimIds.includes(claimId)) units.add(scene.id);
    }
    return [...units];
  };
  const covered = selectedIds
    .map((claimId) => {
      const claim = index.getClaim(claimId);
      if (claim === undefined) throw new DirectorError(`unknown claim ${claimId}`);
      const units = unitIdsFor(claimId);
      return {
        claimId,
        role: roleOf(claim.salience),
        unitIds: units.length > 0 ? units : [`beat-${beats.length}`],
      };
    });
  const omitted = rankedIds
    .filter((id) => !selectedSet.has(id))
    .map((claimId, i) => ({
      claimId,
      reason: `salience rank ${capacity + i + 1} exceeds capacity ${capacity} at ${targetDurationSeconds}s (secondsPerClaim=${secondsPerClaim})`,
    }));

  const planId =
    request.planId ??
    `plan-${primarySource.id}-${mode}-${Math.round(targetDurationSeconds)}s`;

  const plan: OverviewPlan = {
    recordType: 'OverviewPlan',
    contractVersion: CONTRACTS_VERSION,
    id: planId,
    sourceIds: [...graph.sourceIds],
    modality,
    mode,
    objective: `A ${Math.round(targetDurationSeconds)}s ${mode} overview of ${sourceTitle} for a ${audience} audience, grounded in ${selectedIds.length} of ${graph.claims.length} ranked claims.`,
    audience,
    language,
    targetDurationSeconds,
    style: {
      tone: profile.tone,
      register: 'plain-technical',
      pacing: 'measured',
      ...(modality === 'audio' ? { speakerCount: profile.speakers } : {}),
      ...(request.styleBibleId !== undefined ? { styleBibleId: request.styleBibleId } : {}),
    },
    ...(request.customInstructions !== undefined ? { customInstructions: request.customInstructions } : {}),
    coverage: { covered, omitted },
    beats,
    audioTurns,
    videoScenes,
    generator: {
      name: DIRECTOR_ID,
      version: '0.1.0',
      seed,
      deterministic: true,
    },
    createdAt: now,
    notes:
      'Compiled by the deterministic Overview Director. Claim coverage is budget- and salience-driven; custom instructions never change coverage.',
  };

  const guard = OverviewPlanSchema.safeParse(plan);
  if (!guard.success) {
    throw new DirectorError(`compiled plan fails its guard: ${JSON.stringify(guard.error.issues)}`);
  }
  const deep = validateOverviewPlan(plan, graph, sources);
  if (!deep.valid) {
    throw new DirectorError(`compiled plan fails deep validation: ${JSON.stringify(deep.issues)}`);
  }
  return plan;
}
