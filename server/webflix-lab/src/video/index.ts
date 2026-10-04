/**
 * Video Overview pipeline (WFLX-W3, Phase 2B) — public API.
 *
 * compileVideoOverview: OverviewPlan + SemanticGraph
 *   -> VideoScene[] (realized) -> render specs -> deterministic SVG frames
 *   -> illustration provider (offline canonical) -> motion plans
 *   -> narration segments + placeholder audio -> timeline
 *   -> composition (Remotion primary, deterministic fallback)
 *   -> video QA + GeneratedArtifact sidecar.
 *
 * Determinism: identical (plan, graph, seed, providers, backend) produce
 * byte-identical scene SVGs (pinned by the QA determinism hash), identical
 * timeline/narration manifests, and a deterministic artifact id. `now` is
 * REQUIRED for the sidecar timestamp (no hidden clock), mirroring W2.
 *
 * The plan is scene-authoritative: scenes are never added, dropped,
 * reordered or re-typed. Hard validation failures throw VideoCompilerError;
 * soft quality problems surface as typed QA issues naming the scene.
 */

import { readFileSync } from 'node:fs';
import type { GeneratedArtifact, Id, OverviewPlan, SemanticGraph, UtcTimestamp, VideoScene } from '../contracts';
import type { IllustrationProvider } from '../providers/visual/port';
import { selectIllustrationProvider } from '../providers/visual/factory';
import type { MotionProvider } from '../providers/video/port';
import { selectMotionProvider } from '../providers/video/factory';
import { VideoCompilerError } from './errors';
import { compileVideoScenes } from './storyboard/compiler';
import type { SceneCompilerIssue, SceneGraph, StoryboardScene } from './storyboard/types';
import { renderStoryboardSvg } from './render/renderer';
import type { RenderStoryboardResult } from './render/renderer';
import { buildTimeline, type Timeline } from '../compositor/timeline';
import { composeVideo, type CompositionBackend, type ComposeVideoResult } from '../compositor/render';
import {
  synthesizePlaceholderNarration,
  type NarrationSegmentSpec,
  type PlaceholderNarrationResult,
} from '../compositor/narration-audio';
import { runVideoQa, type NarrationSegmentTiming } from './qa/metrics';
import type { VideoQaReport } from './qa/report';
import { emitGeneratedVideoArtifact } from './artifacts';
import type { MotionPlan } from '../providers/video/port';
import type { StyleBible } from './style-bible';

export { VideoCompilerError } from './errors';
export {
  compileVideoScenes,
  planHashOf,
  stableStringify,
  DETERMINISTIC_VISUAL_TYPES,
  GENERATIVE_VISUAL_TYPES,
  HYBRID_VISUAL_TYPES,
  NARRATION_WPS,
} from './storyboard/compiler';
export type { CompileVideoScenesOptions, CompileVideoScenesResult } from './storyboard/compiler';
export type {
  SceneGraph,
  SceneGraphMeta,
  SceneGrounding,
  SceneNarration,
  RenderSpec,
  StoryboardScene,
  SceneCompilerIssue,
  DiagramNodeSpec,
  DiagramEdgeSpec,
  LayoutKind,
} from './storyboard/types';
export {
  STYLE_BIBLE_VERSION,
  REFERENCE_INK_STYLE_BIBLE,
  KNOWN_STYLE_BIBLES,
  isStyleBible,
  parseStyleBible,
  resolveStyleBible,
  styleBibleById,
} from './style-bible';
export type { StyleBible, StyleBiblePalette, StyleBibleTypography, StyleBibleLayout, StyleBibleDiagram, StyleBibleMotion, StyleBiblePacing, StyleBibleEvidence, PaletteEvidence } from './style-bible';
// WFLX-P2 Deliverable A: the custom visual-style layer (deterministic
// StyleBible derivation from a user style prompt — prompt affects visual
// grammar only, never grounding/coverage/structure).
export { customStyleBible, CUSTOM_ACCENT_FAMILIES } from './custom-style';
export type { CustomAccentFamily, CustomStyleOptions } from './custom-style';
// WFLX-P2 Deliverable B: the Short (~60 s) format layer.
export {
  compileShortVideoScenes,
  SHORT_TARGET_SECONDS,
  SHORT_DURATION_BAND,
  SHORT_HOOK_BOOST,
  SHORT_CLAIMS_PER_SCENE,
  SHORT_MIN_SCENE_SECONDS,
} from './short/compiler';
export type {
  CompileShortVideoOptions,
  CompileShortVideoResult,
  ShortClaimDisposition,
  ShortCoverageAccounting,
  ShortCoverageAccountingEntry,
  ShortFormatReport,
} from './short/compiler';
// WFLX-P2 Deliverable C1: the Cinematic asset pipeline.
export {
  buildCinematicPlan,
  cinematicPlanFingerprint,
  cinematicParamsFor,
  subjectKeyFor,
  assetIdentityFor,
  CINEMATIC_DIRECTOR_ID,
} from './cinematic/director';
export type { BuildCinematicPlanOptions, CinematicStyleParams } from './cinematic/director';
export {
  validateCinematicAssets,
  validateCinematicAsset,
  validateCinematicPlan,
  failedGateSceneIds,
} from './cinematic/validation';
export {
  compileCinematicOverview,
  regenerateSceneAssets,
  CINEMATIC_PIPELINE_ID,
} from './cinematic/pipeline';
export type {
  CompileCinematicOptions,
  CompileCinematicResult,
  CinematicRegenerationProof,
  CinematicOverlay,
  CinematicTimelineEntry,
} from './cinematic/pipeline';
export type {
  CameraMove,
  CinematicAssetRecord,
  CinematicPlan,
  CinematicQaReport,
  CinematicSceneStrategy,
  CinematicValidationReport,
  ContinuityConstraint,
  ShotClass,
  ShotPace,
  ShotPlan,
  VisualAssetClass,
  VisualAssetJob,
  AssetValidationOutcome,
} from './cinematic/types';
export { renderSceneSvg, renderStoryboardSvg, scanColors, scanFonts } from './render/renderer';
export type { SceneRenderTrace, RenderSceneInput, RenderStoryboardInput, RenderStoryboardResult } from './render/renderer';
export { buildTimeline, sampleTimelineLayers, frameTimes } from '../compositor/timeline';
export type { Timeline, TimelineEntry, TimelineLayer, TimelineOptions } from '../compositor/timeline';
export { composeVideo, findHeadlessBrowser } from '../compositor/render';
export type { ComposeVideoInput, ComposeVideoResult, CompositionBackend } from '../compositor/render';
export { composeWithFallback, detectFfmpeg } from '../compositor/fallback/compose';
export { renderFrameAt } from '../compositor/fallback/frame-model';
export {
  synthesizePlaceholderNarration,
  encodeWav16Mono,
  NARRATION_SAMPLE_RATE,
} from '../compositor/narration-audio';
export type { NarrationSegmentSpec, PlaceholderNarrationResult } from '../compositor/narration-audio';
export { runVideoQa } from './qa/metrics';
export type { VideoQaInput, NarrationSegmentTiming } from './qa/metrics';
export type { VideoQaReport, VideoQaMetric, VideoQaStatus } from './qa/report';
export { toQaSummary } from './qa/report';
export { emitGeneratedVideoArtifact, deriveVideoArtifactId } from './artifacts';
export { fnv1a32, hashSeed, mulberry32, rngFor, intFor, pickFor, floatFor } from './rng';

export interface CompileVideoOverviewOptions {
  /** Deterministic seed; defaults to the plan generator's seed. */
  readonly seed?: string;
  /** Illustration provider; defaults to the factory selection (offline). */
  readonly illustration?: IllustrationProvider;
  /** Motion provider; defaults to the factory selection (offline). */
  readonly motion?: MotionProvider;
  /** Composition backend; 'auto' prefers Remotion when a browser exists. */
  readonly backend?: CompositionBackend;
  /** Output MP4 path. */
  readonly output: string;
  /** Sidecar timestamp (REQUIRED — no hidden clock). */
  readonly now: UtcTimestamp;
  /** Temp workspace for composition artifacts. */
  readonly workDir?: string;
  /** Skip the second determinism render (tests may opt out for speed). */
  readonly skipDeterminismProof?: boolean;
  /** Explicit browser executable for the Remotion path. */
  readonly browserExecutable?: string;
  /** Override the artifact id (tests). */
  readonly artifactId?: Id;
  /**
   * WFLX-P2 Deliverable A: explicit StyleBible override (the custom-style
   * arm). Passed through to compileVideoScenes; absent -> the plan's own
   * reference resolves exactly as before (zero behavior change).
   */
  readonly styleBible?: StyleBible;
}

export interface CompileVideoOverviewResult {
  readonly scenes: readonly VideoScene[];
  readonly storyboard: SceneGraph;
  readonly compilerIssues: readonly SceneCompilerIssue[];
  readonly render: RenderStoryboardResult;
  readonly determinismProof: { readonly hashA: string; readonly hashB: string | null };
  readonly timeline: Timeline;
  readonly narration: PlaceholderNarrationResult;
  readonly narrationTimings: readonly NarrationSegmentTiming[];
  readonly motionPlans: readonly MotionPlan[];
  readonly composition: ComposeVideoResult;
  readonly qa: VideoQaReport;
  readonly artifact: GeneratedArtifact;
}

/** Scene types that carry a generative illustration layer. */
function needsIllustration(scene: StoryboardScene): boolean {
  return (
    scene.scene.renderingClass === 'generative' ||
    scene.scene.renderingClass === 'hybrid' ||
    scene.render.layoutKind === 'illustration' ||
    scene.render.layoutKind === 'montage'
  );
}

/** Load the annotation file's committed identity (verification helper). */
export function annotationIdentity(): {
  file: string;
  servedVariantSha256: string;
  annotationVersion: string;
} {
  const path = 'reference/annotations/reference-video-scenes.json';
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as {
    annotationVersion: string;
    sha256: string;
  };
  return {
    file: path,
    servedVariantSha256: parsed.sha256,
    annotationVersion: parsed.annotationVersion,
  };
}

/**
 * Compile a full Video Overview end-to-end from a video-modality plan.
 * Deterministic and seeded; see the module docstring for guarantees.
 */
export async function compileVideoOverview(
  plan: OverviewPlan,
  graph: SemanticGraph,
  options: CompileVideoOverviewOptions,
): Promise<CompileVideoOverviewResult> {
  const compiled = compileVideoScenes(plan, graph, {
    ...(options.seed !== undefined ? { seed: options.seed } : {}),
    ...(options.styleBible !== undefined ? { styleBible: options.styleBible } : {}),
  });
  const { storyboard } = compiled;
  const styleBible = storyboard.styleBible;

  // Illustration fragments (offline canonical path is deterministic).
  const illustration =
    options.illustration ??
    selectIllustrationProvider({ ...(options.seed !== undefined ? { seed: options.seed } : {}) }).provider;
  const illustrations = new Map<Id, string>();
  for (const scene of storyboard.scenes) {
    if (!needsIllustration(scene)) {
      continue;
    }
    const result = await illustration.illustrate({
      sceneId: scene.scene.id,
      brief: scene.render.illustrationBrief,
      style: {
        background: styleBible.palette.background.value,
        backgroundDeep: styleBible.palette.backgroundDeep.value,
        surface: styleBible.palette.surface.value,
        ink: styleBible.palette.ink.value,
        emphasis: styleBible.palette.emphasis.value,
        emphasisDeep: styleBible.palette.emphasisDeep.value,
        emphasisSoft: styleBible.palette.emphasisSoft.value,
        warning: styleBible.palette.warning.value,
        accentWarm: styleBible.palette.accentWarm.value,
        accentGreen: styleBible.palette.accentGreen.value,
        aiNode: styleBible.palette.aiNode.value,
        widthPx: styleBible.layout.widthPx,
        heightPx: styleBible.layout.heightPx,
      },
      seed: scene.render.seed,
    });
    illustrations.set(scene.scene.id, result.fragment);
  }

  // Deterministic render (twice when proving determinism).
  const renderInput = {
    storyboard: storyboard.scenes,
    styleBible,
    illustrations,
  };
  const renderA = renderStoryboardSvg(renderInput);
  const renderB = options.skipDeterminismProof === true ? null : renderStoryboardSvg(renderInput);

  // Motion plans (deterministic offline provider by default).
  const motion =
    options.motion ??
    selectMotionProvider({}).provider;
  const timeline = buildTimeline(compiled.scenes, { fps: 30 });
  const motionPlans: MotionPlan[] = [];
  const motionByScene = new Map<Id, MotionPlan>();
  for (const entry of timeline.entries) {
    const scene = storyboard.scenes.find((candidate) => candidate.scene.id === entry.sceneId);
    if (scene === undefined) {
      throw new VideoCompilerError(`timeline references unknown scene ${entry.sceneId}`);
    }
    const motionPlan = await motion.planMotion({
      sceneId: entry.sceneId,
      motion: entry.motion,
      seed: `${storyboard.meta.seed}|${entry.sceneId}`,
      durationSeconds: entry.endSeconds - entry.startSeconds,
      canvasWidthPx: styleBible.layout.widthPx,
      canvasHeightPx: styleBible.layout.heightPx,
    });
    motionPlans.push(motionPlan);
    motionByScene.set(entry.sceneId, motionPlan);
  }

  // Narration segments (one per scene, starting at the scene boundary —
  // narration-led pacing per the StyleBible/annotation).
  const narrationSpecs: NarrationSegmentSpec[] = storyboard.scenes.map((scene) => ({
    segmentId: scene.narration.segmentId,
    sceneId: scene.scene.id,
    startSeconds:
      timeline.entries.find((entry) => entry.sceneId === scene.scene.id)?.startSeconds ?? 0,
  }));
  const narration = synthesizePlaceholderNarration(timeline, narrationSpecs);
  const narrationTimings: NarrationSegmentTiming[] = narrationSpecs.map((spec) => ({
    segmentId: spec.segmentId,
    sceneId: spec.sceneId,
    startSeconds: spec.startSeconds,
  }));

  // Composition (Remotion primary, deterministic fallback).
  const composition = await composeVideo({
    timeline,
    sceneSvgs: renderA.frames,
    motions: motionByScene,
    output: options.output,
    ...(options.backend !== undefined ? { backend: options.backend } : {}),
    narrationWav: narration.wav,
    ...(options.workDir !== undefined ? { workDir: options.workDir } : {}),
    ...(options.browserExecutable !== undefined
      ? { browserExecutable: options.browserExecutable }
      : {}),
  });

  // QA (deterministic metrics only).
  const qa = runVideoQa({
    storyboard,
    renderTraces: renderA.traces,
    timeline,
    narrationTimings,
    styleBible,
    determinismHashA: renderA.combinedSha256,
    ...(renderB !== null ? { determinismHashB: renderB.combinedSha256 } : {}),
  });

  // Provenance sidecar over the composed MP4.
  const { readFileSync: readBytes } = await import('node:fs');
  const mp4Bytes = readBytes(composition.output);
  const artifact = emitGeneratedVideoArtifact({
    plan,
    planHash: storyboard.meta.planHash,
    seed: storyboard.meta.seed,
    render: renderA,
    composition,
    qa,
    illustrationProviderId: illustration.id,
    motionProviderId: motion.id,
    mp4Bytes,
    now: options.now,
    ...(options.artifactId !== undefined ? { artifactId: options.artifactId } : {}),
  });

  return {
    scenes: compiled.scenes,
    storyboard,
    compilerIssues: compiled.issues,
    render: renderA,
    determinismProof: {
      hashA: renderA.combinedSha256,
      hashB: renderB !== null ? renderB.combinedSha256 : null,
    },
    timeline,
    narration,
    narrationTimings,
    motionPlans,
    composition,
    qa,
    artifact,
  };
}
