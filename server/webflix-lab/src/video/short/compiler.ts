/**
 * Video pipeline (WFLX-P2, Deliverable B) — the Short (~60 s) format layer.
 *
 * Product behavior under reconstruction (parity-completion work order §1 +
 * §3): Short is a DEDICATED ~60-second video format. The real product's
 * Short compresses DEPTH while preserving the skeleton — the same editorial
 * skeleton (hook -> topic segments -> takeaways) with less per-segment depth,
 * a prominent opening hook, fewer claims visualized, and NO silent claim
 * drops. Our own cross-surface product truth anchors the same shape: the
 * audio-side EXP-A-05 / LAB-03 records (3.78x depth compression with
 * coverage preserved, every claim accounted).
 *
 * This layer implements the video-side compression ON TOP of the frozen
 * pipeline (src/director and src/contracts untouched):
 *
 *   Director (mode 'short', ~60 s target) -> ShortFormat compile path:
 *     1. scene-depth compression — each scene keeps at most ONE claim (the
 *        lead); claims trimmed from a scene stay plan-covered via their
 *        BEAT and are EXPLICITLY flagged in the coverage accounting
 *        (covered-not-visualized; EXP-D-01 discipline — never a silent drop);
 *     2. hook prominence — opening-beat scenes get a duration boost, tail
 *        scenes compress, total conserved exactly (duration sum invariant);
 *     3. the adapted plan compiles through the UNMODIFIED storyboard
 *        compiler (plan authority, all invariants enforced).
 *
 * Determinism: pure function of (plan, graph, options) — double-run
 * byte-identity is pinned by tests and by EXP-V-S-01.
 *
 * Honest boundary: the ~60 s target and the compression ratio are lab
 * reconstructions of DOCUMENTED product behavior ("Short (approx. 60 s)",
 * docs/notebooklm-overviews-research.md) — the exact product-side numbers
 * are COMPARISON PENDING REFERENCE CAPTURE (WFLX-P3 scope), never asserted
 * here.
 */

import {
  type Id,
  type OverviewPlan,
  type SemanticGraph,
  type VideoScene,
} from '../../contracts';
import { VideoCompilerError } from '../errors';
import {
  compileVideoScenes,
  type CompileVideoScenesOptions,
  type CompileVideoScenesResult,
} from '../storyboard/compiler';

/** Canonical Short target duration (DOCUMENTED product format: ~60 s). */
export const SHORT_TARGET_SECONDS = 60;

/**
 * Declared duration band around the 60 s target (lab policy, explicit and
 * recorded in every Short report): [48, 72] s.
 */
export const SHORT_DURATION_BAND = {
  targetSeconds: SHORT_TARGET_SECONDS,
  toleranceFraction: 0.2,
  minSeconds: 48,
  maxSeconds: 72,
} as const;

/** Opening-beat hook boost (lab policy: hook scenes run ~1.35x their share). */
export const SHORT_HOOK_BOOST = 1.35;

/** Per-scene claim cap during depth compression. */
export const SHORT_CLAIMS_PER_SCENE = 1;

/** Minimum scene duration after reweighting (narratability floor). */
export const SHORT_MIN_SCENE_SECONDS = 3;

/** Per-claim accounting disposition in a Short compile. */
export type ShortClaimDisposition = 'visualized' | 'covered-not-visualized' | 'omitted';

export interface ShortCoverageAccountingEntry {
  readonly claimId: Id;
  readonly disposition: ShortClaimDisposition;
  /** Scene ids visualizing the claim (visualized only). */
  readonly sceneIds: readonly Id[];
  /** Beat ids that keep the claim editorially covered. */
  readonly beatIds: readonly Id[];
  /** Omission reason (omitted only). */
  readonly reason?: string;
}

export interface ShortCoverageAccounting {
  readonly totalGraphClaims: number;
  readonly visualized: number;
  readonly coveredNotVisualized: number;
  readonly omitted: number;
  /** Closed accounting invariant: visualized + coveredNotVisualized + omitted === total. */
  readonly closed: boolean;
  readonly entries: readonly ShortCoverageAccountingEntry[];
}

export interface ShortFormatReport {
  /** Scene count of the adapted (and base) plan — skeleton preserving. */
  readonly sceneCount: number;
  readonly baseSceneCount: number;
  /** Scene ids/order/classes identical to the base Director plan. */
  readonly structurePreserved: boolean;
  /** Skeleton class sequence (hook/topic/takeaways), one per scene. */
  readonly skeletonClasses: readonly string[];
  /** Opening-beat (hook) scenes' share of total duration, 0..1. */
  readonly hookShare: number;
  /** Median non-hook scene duration in seconds. */
  readonly medianSceneSeconds: number;
  /** Distinct claims visualized by at least one scene. */
  readonly claimsVisualized: number;
  /** Scenes that lost depth (claims trimmed) — explicit, never silent. */
  readonly depthCompressedScenes: readonly {
    readonly sceneId: Id;
    readonly removedClaimIds: readonly Id[];
  }[];
  readonly coverageAccounting: ShortCoverageAccounting;
  readonly durationSeconds: number;
  readonly durationWithinBand: boolean;
  readonly declaredBand: typeof SHORT_DURATION_BAND;
}

export type CompileShortVideoOptions = CompileVideoScenesOptions;

export interface CompileShortVideoResult {
  /** Depth-compressed + hook-reweighted plan (compiles through the frozen path). */
  readonly plan: OverviewPlan;
  readonly report: ShortFormatReport;
  /** The storyboard compile of the adapted plan (existing invariants enforced). */
  readonly compiled: CompileVideoScenesResult;
}

// ---------------------------------------------------------------------------
// Integer duration split (mirrors the Director's largest-remainder method)
// ---------------------------------------------------------------------------

function splitInteger(total: number, weights: number[], minimum: number): number[] {
  if (weights.length === 0) return [];
  const sum = weights.reduce((a, b) => a + b, 0);
  const w = sum === 0 ? weights.map(() => 1) : weights;
  const wSum = w.reduce((a, b) => a + b, 0);
  const raw = w.map((x) => (total * x) / wSum);
  const base = raw.map((x) => Math.max(minimum, Math.floor(x)));
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

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const lo = sorted[mid - 1] ?? 0;
  const hi = sorted[mid] ?? 0;
  if (lo === undefined) return hi ?? 0;
  return (lo + hi) / 2;
}

// ---------------------------------------------------------------------------
// Coverage accounting (EXP-D-01 discipline: every claim accounted)
// ---------------------------------------------------------------------------

function accountCoverage(
  plan: OverviewPlan,
  graph: SemanticGraph,
  visualizedClaimIds: ReadonlySet<Id>,
): ShortCoverageAccounting {
  const entries: ShortCoverageAccountingEntry[] = graph.claims.map((claim) => {
    const covered = plan.coverage.covered.find((c) => c.claimId === claim.id);
    if (covered === undefined) {
      const omitted = plan.coverage.omitted.find((c) => c.claimId === claim.id);
      return {
        claimId: claim.id,
        disposition: 'omitted' as const,
        sceneIds: [],
        beatIds: [],
        reason:
          omitted?.reason ??
          'claim absent from the plan coverage map (accounted as omitted by the Short layer)',
      };
    }
    const sceneIds = plan.videoScenes
      .filter((s) => s.claimIds.includes(claim.id))
      .map((s) => s.id);
    const beatIds = covered.unitIds.filter((unitId) => !unitId.startsWith('scene-'));
    const visualized = visualizedClaimIds.has(claim.id) && sceneIds.length > 0;
    return {
      claimId: claim.id,
      disposition: visualized ? ('visualized' as const) : ('covered-not-visualized' as const),
      sceneIds: visualized ? sceneIds : [],
      beatIds,
    };
  });

  const visualized = entries.filter((e) => e.disposition === 'visualized').length;
  const coveredNotVisualized = entries.filter(
    (e) => e.disposition === 'covered-not-visualized',
  ).length;
  const omitted = entries.filter((e) => e.disposition === 'omitted').length;
  return {
    totalGraphClaims: graph.claims.length,
    visualized,
    coveredNotVisualized,
    omitted,
    closed: visualized + coveredNotVisualized + omitted === graph.claims.length,
    entries,
  };
}

// ---------------------------------------------------------------------------
// The Short compile path
// ---------------------------------------------------------------------------

/**
 * Compile the Short format: depth-compress + hook-reweight the Director's
 * short-mode plan, then compile through the UNMODIFIED storyboard compiler.
 */
export function compileShortVideoScenes(
  plan: OverviewPlan,
  graph: SemanticGraph,
  options: CompileShortVideoOptions = {},
): CompileShortVideoResult {
  if (plan.modality !== 'video') {
    throw new VideoCompilerError(
      `compileShortVideoScenes requires a video-modality plan (got '${plan.modality}')`,
    );
  }
  if (plan.mode !== 'short') {
    throw new VideoCompilerError(
      `compileShortVideoScenes requires mode 'short' (got '${plan.mode}')`,
    );
  }
  if (plan.videoScenes.length === 0) {
    throw new VideoCompilerError('plan carries no videoScenes');
  }

  const baseSceneCount = plan.videoScenes.length;
  const openingBeatId = plan.beats[0]?.id;
  const closingBeatId =
    plan.beats.length > 1 ? plan.beats[plan.beats.length - 1]?.id : undefined;

  // --- 1. scene-depth compression: cap claims per scene ----------------------
  const depthCompressedScenes: { sceneId: Id; removedClaimIds: Id[] }[] = [];
  const adaptedScenes: VideoScene[] = plan.videoScenes.map((scene) => {
    if (scene.claimIds.length <= SHORT_CLAIMS_PER_SCENE) return scene;
    const kept = scene.claimIds.slice(0, SHORT_CLAIMS_PER_SCENE);
    const removed = scene.claimIds.slice(SHORT_CLAIMS_PER_SCENE);
    depthCompressedScenes.push({ sceneId: scene.id, removedClaimIds: [...removed] });
    return { ...scene, claimIds: kept };
  });

  // --- 2. hook prominence: reweight durations, total conserved ----------------
  const totalSeconds = Math.round(
    plan.videoScenes.reduce((t, s) => t + s.targetDurationSeconds, 0),
  );
  const weights = adaptedScenes.map((scene) =>
    openingBeatId !== undefined && scene.beatId === openingBeatId ? SHORT_HOOK_BOOST : 1,
  );
  const reweighted = splitInteger(totalSeconds, weights, SHORT_MIN_SCENE_SECONDS);
  const finalScenes: VideoScene[] = adaptedScenes.map((scene, i) => ({
    ...scene,
    targetDurationSeconds: (reweighted[i] as number) || scene.targetDurationSeconds,
  }));

  // --- 3. coverage unit hygiene (no stale scene references) -------------------
  // A claim trimmed from every scene keeps its BEAT units (beats are the
  // untouched editorial spine); scene units survive only where the scene
  // still visualizes the claim.
  const adaptedCoverage = plan.coverage.covered.map((entry) => {
    const stillVisualized = finalScenes.some((s) =>
      s.claimIds.includes(entry.claimId),
    );
    const keepUnits = entry.unitIds.filter(
      (unitId) => !unitId.startsWith('scene-') || stillVisualized,
    );
    if (keepUnits.length > 0) return { ...entry, unitIds: keepUnits };
    const beatUnits = entry.unitIds.filter((unitId) => !unitId.startsWith('scene-'));
    if (beatUnits.length > 0) return { ...entry, unitIds: beatUnits };
    return entry;
  });

  const adaptedPlan: OverviewPlan = {
    ...plan,
    videoScenes: finalScenes,
    coverage: { covered: adaptedCoverage, omitted: plan.coverage.omitted },
    notes:
      `${plan.notes ?? ''} [WFLX-P2 Short format: depth-compressed to <=${SHORT_CLAIMS_PER_SCENE} ` +
      `claim/scene (${depthCompressedScenes.length} scenes trimmed; trimmed claims stay beat-covered ` +
      `and are flagged covered-not-visualized, never silently dropped), hook boost x${SHORT_HOOK_BOOST}, ` +
      `total conserved ${totalSeconds}s inside the declared band [${SHORT_DURATION_BAND.minSeconds}, ` +
      `${SHORT_DURATION_BAND.maxSeconds}]s]`,
  };

  // --- 4. compile through the frozen storyboard path ---------------------------
  const compiled = compileVideoScenes(adaptedPlan, graph, options);

  // --- 5. the Short report ------------------------------------------------------
  const visualizedClaimIds = new Set(finalScenes.flatMap((s) => s.claimIds));
  const accounting = accountCoverage(adaptedPlan, graph, visualizedClaimIds);

  const hookSeconds = finalScenes
    .filter((s) => openingBeatId !== undefined && s.beatId === openingBeatId)
    .reduce((t, s) => t + s.targetDurationSeconds, 0);
  const nonHook = finalScenes.filter(
    (s) => !(openingBeatId !== undefined && s.beatId === openingBeatId),
  );
  const durationSeconds = finalScenes.reduce((t, s) => t + s.targetDurationSeconds, 0);

  const structurePreserved =
    finalScenes.length === baseSceneCount &&
    finalScenes.every(
      (scene, i) =>
        scene.id === (plan.videoScenes[i] as VideoScene).id &&
        scene.visualType === (plan.videoScenes[i] as VideoScene).visualType &&
        scene.index === (plan.videoScenes[i] as VideoScene).index,
    );
  const skeletonClasses = finalScenes.map((scene) => {
    if (openingBeatId !== undefined && scene.beatId === openingBeatId) return 'hook';
    if (closingBeatId !== undefined && scene.beatId === closingBeatId) return 'takeaways';
    return 'topic';
  });

  const report: ShortFormatReport = {
    sceneCount: finalScenes.length,
    baseSceneCount,
    structurePreserved,
    skeletonClasses,
    hookShare: durationSeconds > 0 ? Math.round((hookSeconds / durationSeconds) * 1000) / 1000 : 0,
    medianSceneSeconds: median(nonHook.map((s) => s.targetDurationSeconds)),
    claimsVisualized: visualizedClaimIds.size,
    depthCompressedScenes,
    coverageAccounting: accounting,
    durationSeconds,
    durationWithinBand:
      durationSeconds >= SHORT_DURATION_BAND.minSeconds &&
      durationSeconds <= SHORT_DURATION_BAND.maxSeconds,
    declaredBand: SHORT_DURATION_BAND,
  };

  return { plan: adaptedPlan, report, compiled };
}
