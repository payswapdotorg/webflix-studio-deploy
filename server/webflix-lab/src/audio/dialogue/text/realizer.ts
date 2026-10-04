/**
 * Audio pipeline (WFLX-W2, Stage 2) — deterministic surface realization.
 *
 * Fills the plan's `AudioTurn.text` (the contract leaves text absent at plan
 * level; W2 fills it, src/contracts/audio-turn.ts). Design constraints:
 *
 * - GROUNDED: factual content is realized from the claim statements the turn
 *   cites (verbatim restatement) plus plan-authoritative brief/beat guidance.
 *   The realizer never invents facts — discourse glue (openers, tails,
 *   connectors) carries no factual assertions (DESIGN.md §3.2).
 * - SEEDED: every stochastic choice (opener pick, connector pick, tail pick)
 *   is keyed by (seed, turn-LOCAL content hash, turnId, slot) — the C-5 v2
 *   re-keying (src/contracts/unit-content-hash.ts): the hash covers
 *   [turn.brief, ...anchorStatements], so a one-claim change reshuffles
 *   only the turns whose OWN content changed; reordering cannot change a
 *   pick; regenerating one turn is stable (§10). planHash stays OUT of
 *   stochastic keys (it is plan-global by design and lives in
 *   identification surfaces only).
 * - BUDGETED: text density fits the turn's authoritative target duration via
 *   the rate model (§16.2 item 3). Compression drops glue first; anchors are
 *   never dropped. If mandatory anchors cannot fit within the mode rate
 *   ceiling, the turn is flagged `overBudget` and QA raises
 *   `turn-over-budget` — never a silent claim drop, never a velocity hack
 *   (H-A-05).
 * - CONVERSATIONAL: question turns embed the anchored statement and ask a
 *   natural tail; answers acknowledge the question; same-speaker
 *   continuations open differently (§16.2 item 4: conversational tissue is
 *   realized inside the frozen turns).
 *
 * Language (§11): template markers localize via the language packs; claim
 * statements stay in the source language (no machine translation in the
 * deterministic path — documented lab limitation, flagged by QA as
 * `anchors-not-localized`).
 */

import { countWords, unitContentHash, type Id, type OverviewPlan } from '../../../contracts';
import { pickFor } from '../../rng';
import type { EnumerationSpine, ModeProfile, SurfacePack, TagFamily } from '../../modes/common';
import { TAG_FAMILY } from '../../modes/common';
import { overlayPack } from '../../modes/common';
import { languagePackFor } from '../../modes/language-packs';
import type { BeatIndex, ClaimIndex, DialogueGraph, DialogueTurn } from '../types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Realization outcome for one turn. */
export interface RealizedTurn {
  readonly turnId: Id;
  readonly text: string;
  readonly wordCount: number;
  /** Rate-model budget: round(rate * targetDurationSeconds). */
  readonly budgetWords: number;
  readonly minWords: number;
  readonly maxWords: number;
  /** True when mandatory anchors cannot fit the mode rate ceiling (QA error). */
  readonly overBudget: boolean;
}

/** Everything the realizer needs; assembled by the public compiler API. */
export interface RealizerContext {
  readonly plan: OverviewPlan;
  readonly graph: DialogueGraph;
  readonly claimIndex: ClaimIndex;
  readonly beatIndex: BeatIndex;
  readonly profile: ModeProfile;
  /** Effective speaking rate (words/s) after pacing multiplier. */
  readonly rate: number;
  /** Language pack actually used + whether it was a fallback. */
  readonly languageId: string;
  readonly languageFallback: boolean;
}

// ---------------------------------------------------------------------------
// Text helpers (pure)
// ---------------------------------------------------------------------------

/** Sentence-case: first letter upper, collapsed whitespace. */
function sentenceCase(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed.length === 0) return collapsed;
  return collapsed.charAt(0).toUpperCase() + collapsed.slice(1);
}

/** Lowercase first letter (for embedding a statement mid-sentence). */
function lowerFirst(text: string): string {
  if (text.length === 0) return text;
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/** Ensure the statement ends with a period (not ? or ! — claims are declarative). */
function asStatement(text: string): string {
  const trimmed = sentenceCase(text);
  if (trimmed.length === 0) return trimmed;
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/** Strip the terminal period and lowercase the first letter for embedding. */
function asEmbeddedFragment(text: string): string {
  return lowerFirst(asStatement(text).replace(/\.\s*$/, ''));
}

/** Clean a claim statement into a spoken anchor sentence. */
function anchorSentence(statement: string): string {
  return asStatement(statement.replace(/\s+/g, ' ').trim());
}

/**
 * Trim an evidence quote to a speakable sentence fragment: at most
 * `maxWords`, cut at a sentence boundary when possible. Returns null when the
 * quote is too short to be worth quoting (fragments like "forecasting").
 */
function speakableQuote(quote: string, maxWords = 22): string | null {
  const cleaned = quote.replace(/\s+/g, ' ').trim();
  if (cleaned.length === 0) return null;
  const words = cleaned.split(' ');
  if (words.length < 4) return null;
  if (words.length <= maxWords) return cleaned;
  const cut = words.slice(0, maxWords).join(' ');
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  if (stop > 16) {
    return cut.slice(0, stop + 1);
  }
  return cut;
}

// ---------------------------------------------------------------------------
// Realization
// ---------------------------------------------------------------------------

/** Resolve the spoken anchors for a turn: cited claim statements, in order. */
function anchorStatements(ctx: RealizerContext, turn: DialogueTurn): string[] {
  const anchors: string[] = [];
  for (const claimId of turn.claimIds) {
    const claim = ctx.claimIndex.get(claimId);
    if (claim !== undefined) {
      anchors.push(anchorSentence(claim.statement));
    }
  }
  return anchors;
}

/**
 * Turn-LOCAL content hash for C-5 seeding (src/contracts/unit-content-hash.ts
 * documents this composition as the audio-turn surface):
 * unitContentHash([turn.brief, ...anchorStatements]). The turn id stays a
 * PURE identifier — it never feeds the hash. One shared derivation serves
 * the realizer keys AND the timing-gap keys (via the audio compiler).
 */
export function turnContentHash(ctx: RealizerContext, turn: DialogueTurn): string {
  return unitContentHash([turn.brief, ...anchorStatements(ctx, turn)]);
}

function surfacePackFor(ctx: RealizerContext): SurfacePack {
  const { pack } = languagePackFor(ctx.plan.language);
  return overlayPack(pack, ctx.profile.surfaceOverlay);
}

// ---------------------------------------------------------------------------
// Enumeration spine (C-10, EV-009 LAB-02)
// ---------------------------------------------------------------------------

/**
 * C-10 position-based opener for spine-declared families (the monologic
 * brief's First/Second/…/Finally). `position` is 1-based among the graph's
 * spine-family turns in spoken order; the LAST spine turn takes the final
 * marker. Returns null when the profile declares no spine, the family is
 * not on the spine, or the position has no honest marker (single-item
 * spines and ordinals beyond the declared list degrade to NO enumeration
 * opener — the seeded/overlay path then applies, never a wrong marker).
 * NEVER a seeded pick: enumeration ordering is structural product truth.
 */
export function enumerationOpenerFor(
  enumeration: EnumerationSpine | undefined,
  family: TagFamily,
  position: number,
  spineSize: number,
): string | null {
  if (enumeration === undefined || !enumeration.families.includes(family)) return null;
  if (spineSize <= 1) return null;
  if (position === spineSize) return enumeration.finalOpener;
  return enumeration.ordinalOpeners[position - 1] ?? null;
}

/**
 * Spine position of every turn (C-10): 1-based index among turns whose
 * template family sits on the profile's enumeration spine, plus the spine
 * size. Empty when the profile declares no spine (dialogic modes).
 */
function spinePositionsOf(ctx: RealizerContext): ReadonlyMap<Id, { position: number; size: number }> {
  const byId = new Map<Id, { position: number; size: number }>();
  const enumeration = ctx.profile.enumeration;
  if (enumeration === undefined) return byId;
  const spineIds = ctx.graph.turns
    .filter((turn) => enumeration.families.includes(TAG_FAMILY[turn.enrichedTag]))
    .map((turn) => turn.id);
  spineIds.forEach((id, i) => byId.set(id, { position: i + 1, size: spineIds.length }));
  return byId;
}

/** Topical basis for zero-claim turns: the beat title (plan-authoritative). */
function topicalBasis(ctx: RealizerContext, turn: DialogueTurn): string {
  if (turn.beatId !== undefined) {
    const beat = ctx.beatIndex.get(turn.beatId);
    if (beat !== undefined && beat.title.length > 0) {
      return beat.title.replace(/\s+/g, ' ').trim();
    }
  }
  return ctx.plan.objective;
}

function budgetFor(ctx: RealizerContext, turn: DialogueTurn): { budget: number; min: number; max: number } {
  const budget = Math.round(ctx.rate * turn.targetDurationSeconds);
  const min = Math.max(4, Math.round(budget * 0.55));
  const max = Math.max(min + 2, Math.round(ctx.rate * ctx.profile.rate.ceilMultiplier * turn.targetDurationSeconds));
  return { budget, min, max };
}

/** Compose the core utterance (anchors + glue) for a turn family.
 * Returns both the opener-bearing core and the BARE anchor block (the last
 * rung of the over-budget ladder — glue drops before anchors, never after). */
function composeCore(
  ctx: RealizerContext,
  turn: DialogueTurn,
  family: TagFamily,
  anchors: readonly string[],
  pack: SurfacePack,
  spine: { position: number; size: number } | undefined,
): { core: string; bare: string; isQuestion: boolean } {
  const key = (slot: string) => `${ctx.graph.meta.seed}|${turnContentHash(ctx, turn)}|${turn.id}|${slot}`;
  // C-10: spine-declared families open by POSITION (First/…/Finally —
  // never a seeded pick); everything else keeps the C-5 seeded picks.
  const enumOpener = enumerationOpenerFor(
    ctx.profile.enumeration,
    family,
    spine?.position ?? 0,
    spine?.size ?? 0,
  );
  const openerOptions = pack.openers[family];
  const opener = enumOpener
    ?? (openerOptions !== undefined && openerOptions.length > 0 ? pickFor(key('opener'), openerOptions) : '');
  const openerKeepsCapital = opener.endsWith(':') || opener.endsWith('.') || opener === '';

  const basis = anchors.length > 0 ? anchors : [topicalBasis(ctx, turn)];

  if (family === 'interjection') {
    // Short backchannels: opener only (plus a compact anchor when grounded).
    const backchannel = opener !== '' ? opener : 'Right.';
    if (anchors.length === 0) {
      return { core: backchannel, bare: backchannel, isQuestion: false };
    }
    const anchored = `${backchannel} ${asEmbeddedFragment(anchors[0] ?? '')}`;
    return { core: anchored, bare: asStatement(anchors[0] ?? ''), isQuestion: false };
  }

  if (family === 'question') {
    // Embedded anchored statement + natural question tail. C-10: monologic
    // modes REMOVE the question-tail surface (dialogic tissue) — a plan-level
    // question turn in such a mode degrades to its bare embedded anchors and
    // is flagged by QA mode-semantics (discouraged purpose), never a crash.
    const embedded = basis.map((anchor) => asEmbeddedFragment(anchor));
    const joined = embedded.length === 1
      ? embedded[0] ?? ''
      : embedded.join(pickFor(key('connector'), pack.anchorConnectors));
    const tail = pack.questionTails.length > 0 ? pickFor(key('tail'), pack.questionTails) : '';
    const anchorBlock = tail !== '' ? `${joined} — ${tail}` : sentenceCase(joined);
    return {
      core: opener === '' ? sentenceCase(anchorBlock) : `${opener} ${lowerFirst(anchorBlock)}`,
      bare: sentenceCase(anchorBlock),
      isQuestion: tail !== '',
    };
  }

  // Statement-like families: anchors flow as assertions.
  const statements = basis.map((anchor) => asStatement(anchor));
  const anchorBlock =
    statements.length === 1
      ? statements[0] ?? ''
      : statements.map((s, i) => (i === 0 ? s : asStatement(pickFor(key(`connector-${i}`), pack.anchorConnectors) + lowerFirst(s)))).join(' ');

  if (family === 'transition') {
    // Transitions lean on the topical basis — but a transition that CITES
    // claims must voice them (grounding rule: cited claims are never silent).
    const bare =
      anchors.length > 0 ? anchorBlock : `${topicalBasis(ctx, turn)}.`;
    return {
      core: opener === '' ? bare : `${opener} ${lowerFirst(bare)}`.replace(/\s+/g, ' ').trim(),
      bare,
      isQuestion: false,
    };
  }

  return {
    core: opener === ''
      ? anchorBlock
      : `${opener} ${openerKeepsCapital ? anchorBlock : lowerFirst(anchorBlock)}`,
    bare: anchorBlock,
    isQuestion: false,
  };
}

/** Conversational prefix: acknowledge a pending question / continue own turn.
 * C-10: monologic modes carry NO conversational prefixes — the enumeration
 * spine is the connective device; acknowledgement/continuation tissue is
 * dialogic and suppressed (a single narrator acknowledges no co-host). */
function conversationalPrefix(
  ctx: RealizerContext,
  turn: DialogueTurn,
  previous: DialogueTurn | undefined,
  pack: SurfacePack,
): string {
  if (ctx.profile.monologic === true) return '';
  if (previous === undefined) return '';
  const key = `${ctx.graph.meta.seed}|${turnContentHash(ctx, turn)}|${turn.id}|prefix`;
  const answersPrevious =
    previous.speakerRole !== turn.speakerRole &&
    previous.purpose === 'question' &&
    turn.purpose !== 'question' &&
    turn.purpose !== 'interjection';
  if (answersPrevious) {
    return pack.acknowledgePrefixes.length > 0 ? pickFor(key, pack.acknowledgePrefixes) : '';
  }
  const continuesOwn =
    previous.speakerRole === turn.speakerRole && turn.purpose !== 'interjection';
  if (continuesOwn) {
    return pickFor(key, pack.continuationPrefixes);
  }
  return '';
}

/** Find a speakable evidence quote for under-budget expansion. */
function evidenceQuote(ctx: RealizerContext, turn: DialogueTurn): string | null {
  for (const span of turn.evidence) {
    const quote = speakableQuote(span.quote);
    if (quote !== null) return quote;
  }
  // Fall back to the first cited claim's top evidence span.
  for (const claimId of turn.claimIds) {
    const claim = ctx.claimIndex.get(claimId);
    if (claim === undefined) continue;
    for (const span of claim.evidence) {
      const quote = speakableQuote(span.quote);
      if (quote !== null) return quote;
    }
  }
  return null;
}

/**
 * Realize one turn: compose, then fit the authoritative word budget.
 * Over-budget ladder: drop closer -> drop opener -> flag (anchors never drop).
 * Under-budget expansion: closer -> evidence quote.
 *
 * `spine` carries the turn's C-10 enumeration-spine position (position among
 * the profile's spine-family turns + spine size); omit it when realizing a
 * turn in isolation (spine openers then degrade to the seeded/overlay path,
 * as they must outside whole-graph realization).
 */
export function realizeTurn(
  ctx: RealizerContext,
  turn: DialogueTurn,
  previous: DialogueTurn | undefined,
  spine?: { position: number; size: number },
): RealizedTurn {
  const pack = surfacePackFor(ctx);
  const family = TAG_FAMILY[turn.enrichedTag];
  const { budget, min, max } = budgetFor(ctx, turn);
  const anchors = anchorStatements(ctx, turn);

  const { core, bare, isQuestion } = composeCore(ctx, turn, family, anchors, pack, spine);
  const prefix = conversationalPrefix(ctx, turn, previous, pack);
  const closerOptions = pack.closers[family] ?? [];
  const evidence = evidenceQuote(ctx, turn);
  const key = (slot: string) => `${ctx.graph.meta.seed}|${turnContentHash(ctx, turn)}|${turn.id}|${slot}`;
  const closer =
    closerOptions.length > 0 && !isQuestion && family !== 'interjection'
      ? pickFor(key('closer'), closerOptions)
      : '';

  // Fullest-first candidate levels for the over-budget ladder (glue drops
  // before anchors; question tails stay — they carry interrogative meaning):
  //   v0 = prefix + core(+closer)   v1 = core(+closer)
  //   v2 = core                     v3 = bare anchors
  const withCloser = closer !== '' ? `${core} ${closer}` : core;
  const v0 = prefix === '' ? withCloser : `${prefix} ${lowerFirst(withCloser)}`;
  const v1 = withCloser;
  const v2 = core;
  const v3 = bare;

  const wc = (text: string): number => countWords(text);
  const candidates = [v0, v1, v2, v3];
  let chosen = candidates.find((cand) => wc(cand) <= max);
  let overBudget = false;
  if (chosen === undefined) {
    // Mandatory anchors cannot fit the mode rate ceiling: keep the honest
    // minimal realization and flag — never drop anchors, never speed up.
    chosen = v2;
    overBudget = true;
  } else {
    // Under-budget expansion (deterministic ladder): closer, then evidence.
    if (wc(chosen) < min && closer !== '' && !chosen.includes(closer)) {
      const candidate = `${chosen} ${closer}`;
      if (wc(candidate) <= max) {
        chosen = candidate;
      }
    }
    if (wc(chosen) < min && evidence !== null && anchors.length > 0) {
      const intro = pickFor(key('evintro'), pack.evidenceIntros);
      const candidate = `${chosen} ${intro} "${evidence}"`;
      if (wc(candidate) <= max) {
        chosen = candidate;
      }
    }
  }

  const finalText = sentenceCase(chosen.replace(/\s+/g, ' ').trim());
  return {
    turnId: turn.id,
    text: finalText,
    wordCount: wc(finalText),
    budgetWords: budget,
    minWords: min,
    maxWords: max,
    overBudget,
  };
}

/** Realize every turn of the graph (spoken order). */
export function realizeDialogue(ctx: RealizerContext): readonly RealizedTurn[] {
  const out: RealizedTurn[] = [];
  // C-10: enumeration-spine positions are a property of the WHOLE graph
  // (position among the profile's spine-family turns) — computed once here.
  const spine = spinePositionsOf(ctx);
  let previous: DialogueTurn | undefined;
  for (const turn of ctx.graph.turns) {
    out.push(realizeTurn(ctx, turn, previous, spine.get(turn.id)));
    previous = turn;
  }
  return out;
}

/** Attach realized text onto plan turns, producing script-level AudioTurns. */
export function attachText(
  plan: OverviewPlan,
  realized: readonly RealizedTurn[],
): OverviewPlan['audioTurns'] {
  const byId = new Map(realized.map((r) => [r.turnId, r]));
  return plan.audioTurns.map((turn) => {
    const hit = byId.get(turn.id);
    return hit === undefined ? turn : { ...turn, text: hit.text };
  });
}
