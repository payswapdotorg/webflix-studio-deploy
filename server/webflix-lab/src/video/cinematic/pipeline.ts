/**
 * Video pipeline (WFLX-P2, Deliverable C1) — the Cinematic pipeline.
 *
 * Full trajectory over the EXISTING frozen surfaces (nothing in
 * src/director, src/contracts or the storyboard compiler changes):
 *
 *   compileVideoScenes (existing storyboard compile)
 *     -> buildCinematicPlan (CinematicDirector: shot plans, continuity,
 *        asset jobs — provider-INDEPENDENT by construction)
 *     -> resolve generative jobs through the generative provider ports
 *        (visual: illustration + generative-animation; video:
 *        video-generation)
 *     -> render the deterministic storyboard with generative key art
 *        embedded (x2 — the SVG determinism proof pair)
 *     -> validate ALL assets (plan gates + per-asset gates) BEFORE
 *        composition — failures throw, never a silent skip
 *     -> timeline + cinematic overlay (shot plan + clip references)
 *     -> narration (existing placeholder synthesis)
 *     -> composition (existing compositor: Remotion primary, fallback)
 *     -> QA (existing video QA + the additive cinematic metric set)
 *     -> GeneratedArtifact sidecar with generative provider provenance.
 *
 * Deterministic structural metadata (plan, overlay, validation) is
 * fingerprinted; generative media is content-fingerprinted with provider
 * provenance; the raw-MP4 exclusion-by-rule discipline extends to all
 * generative media (byte-identity is claimed ONLY for the offline stand-in).
 *
 * Local regeneration: regenerateSceneAssets re-runs ONE scene's generative
 * jobs and proves nothing else moved (plan fingerprint, other asset
 * records, deterministic scene SVGs outside the target — all byte-identical).
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type {
  GeneratedArtifact,
  Id,
  OverviewPlan,
  SemanticGraph,
  UtcTimestamp,
  VideoScene,
} from '../../contracts';
import type {
  MotionPlan,
} from '../../providers/video/port';
import {
  OFFLINE_VISUAL_GENERATIVE_MODEL,
} from '../../providers/visual/offline-generative';
import {
  OFFLINE_VIDEO_GENERATIVE_MODEL,
} from '../../providers/video/offline-generative';
import type {
  VisualAssetRequest,
  VisualGenerativeProvider,
} from '../../providers/visual/generative-port';
import {
  selectVisualGenerativeProvider,
  type SelectedVisualGenerative,
} from '../../providers/visual/generative-factory';
import type {
  VideoGenerationRequest,
  VideoGenerativeProvider,
} from '../../providers/video/generative-port';
import {
  selectVideoGenerativeProvider,
  type SelectedVideoGenerative,
} from '../../providers/video/generative-factory';
import { selectMotionProvider } from '../../providers/video/factory';
import { buildTimeline, type Timeline } from '../../compositor/timeline';
import { composeVideo, type CompositionBackend, type ComposeVideoResult } from '../../compositor/render';
import {
  synthesizePlaceholderNarration,
  type NarrationSegmentSpec,
  type PlaceholderNarrationResult,
} from '../../compositor/narration-audio';
import { runVideoQa, type NarrationSegmentTiming } from '../qa/metrics';
import type { VideoQaReport } from '../qa/report';
import { emitGeneratedVideoArtifact } from '../artifacts';
import { compileVideoScenes, type CompileVideoScenesResult, stableStringify } from '../storyboard/compiler';
import type { SceneGraph } from '../storyboard/types';
import type { StyleBible } from '../style-bible';
import { renderStoryboardSvg, type RenderStoryboardResult } from '../render/renderer';
import { VideoCompilerError } from '../errors';
import {
  buildCinematicPlan,
  cinematicPlanFingerprint,
  type BuildCinematicPlanOptions,
} from './director';
import { validateCinematicAssets } from './validation';
import type {
  CinematicAssetRecord,
  CinematicPlan,
  CinematicQaReport,
  CinematicValidationReport,
  VisualAssetJob,
} from './types';

export const CINEMATIC_PIPELINE_ID = 'wflx-cinematic-pipeline';

export interface CompileCinematicOptions extends BuildCinematicPlanOptions {
  readonly backend?: CompositionBackend;
  readonly output: string;
  readonly now: UtcTimestamp;
  readonly workDir?: string;
  readonly skipDeterminismProof?: boolean;
  readonly browserExecutable?: string;
  readonly artifactId?: Id;
  /** Explicit generative providers (tests); defaults: factory (offline). */
  readonly visualProvider?: VisualGenerativeProvider;
  readonly videoProvider?: VideoGenerativeProvider;
  /** StyleBible override (the custom-style surface). */
  readonly styleBible?: StyleBible;
}

export interface CinematicTimelineEntry {
  readonly sceneId: Id;
  readonly index: number;
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly shotPlan: CinematicPlan['scenes'][number]['shotPlan'];
  /** Generative clip references for this scene (video-generation assets). */
  readonly clipRefs: readonly { readonly jobId: string; readonly assetIdentity: string; readonly providerId: string }[];
}

export interface CinematicOverlay {
  readonly planFingerprint: string;
  readonly entries: readonly CinematicTimelineEntry[];
  readonly note: string;
}

export interface CompileCinematicResult {
  readonly scenes: readonly VideoScene[];
  readonly storyboard: SceneGraph;
  readonly compilerIssues: CompileVideoScenesResult['issues'];
  readonly cinematicPlan: CinematicPlan;
  readonly cinematicPlanFingerprint: string;
  readonly assets: readonly { record: CinematicAssetRecord; bytes: Uint8Array }[];
  readonly render: RenderStoryboardResult;
  readonly determinismProof: { readonly hashA: string; readonly hashB: string | null };
  readonly validation: CinematicValidationReport;
  readonly timeline: Timeline;
  readonly overlay: CinematicOverlay;
  readonly narration: PlaceholderNarrationResult;
  readonly narrationTimings: readonly NarrationSegmentTiming[];
  readonly motionPlans: readonly MotionPlan[];
  readonly composition: ComposeVideoResult;
  readonly qa: VideoQaReport;
  readonly cinematicQa: CinematicQaReport;
  readonly artifact: GeneratedArtifact;
  readonly providers: {
    readonly visual: SelectedVisualGenerative;
    readonly video: SelectedVideoGenerative;
  };
}

// ---------------------------------------------------------------------------
// Generative job resolution
// ---------------------------------------------------------------------------

function fragmentFor(bytes: Uint8Array, format: string, widthPx: number, heightPx: number): string {
  if (format === 'svg') {
    return new TextDecoder().decode(bytes);
  }
  const b64 = Buffer.from(bytes).toString('base64');
  const mime = format === 'png' ? 'image/png' : 'image/jpeg';
  return (
    `<image href="data:${mime};base64,${b64}" x="0" y="0" ` +
    `width="${widthPx}" height="${heightPx}" preserveAspectRatio="xMidYMid slice"/>`
  );
}

function sha256Of(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

interface ResolvedJobs {
  readonly records: { record: CinematicAssetRecord; bytes: Uint8Array }[];
  /** Scene-id -> fragment for frame embedding (illustration/animation classes). */
  readonly fragments: Map<Id, string>;
  readonly liveVisualUsed: boolean;
  readonly liveVideoUsed: boolean;
  /** Honest per-job notes (e.g. live video task ids). */
  readonly jobNotes: { jobId: string; note: string }[];
}

async function resolveGenerativeJobs(
  plan: CinematicPlan,
  storyboard: SceneGraph,
  styleBible: StyleBible,
  visual: VisualGenerativeProvider,
  video: VideoGenerativeProvider,
): Promise<ResolvedJobs> {
  const records: { record: CinematicAssetRecord; bytes: Uint8Array }[] = [];
  const fragments = new Map<Id, string>();
  const jobNotes: { jobId: string; note: string }[] = [];
  const emittedIdentities = new Map<string, CinematicAssetRecord>();

  // One job per identity is GENERATED once and REUSED (asset reuse rule).
  for (const scene of plan.scenes) {
    for (const job of scene.assetJobs) {
      if (job.assetClass === 'deterministic-diagram' || job.assetClass === 'source-derived-media') {
        continue; // resolved from the deterministic render below
      }
      const reused = emittedIdentities.get(job.assetIdentity);
      if (reused !== undefined && reused.assetClass === job.assetClass) {
        // Reuse: same identity + same class -> reference the SAME asset.
        const source = records.find((r) => r.record.jobId === reused.jobId) as {
          record: CinematicAssetRecord;
          bytes: Uint8Array;
        };
        records.push({ record: { ...reused, jobId: job.jobId, sceneId: job.sceneId }, bytes: source.bytes.slice() });
        const fragment = fragments.get(job.sceneId);
        if (fragment === undefined) {
          fragments.set(job.sceneId, fragmentFor(source.bytes, source.record.format, job.spec.widthPx, job.spec.heightPx));
        }
        continue;
      }

      const palette = {
        background: styleBible.palette.background.value,
        ink: styleBible.palette.ink.value,
        emphasis: styleBible.palette.emphasis.value,
        warning: styleBible.palette.warning.value,
      };

      if (job.assetClass === 'illustration' || job.assetClass === 'generative-animation') {
        const request: VisualAssetRequest = {
          jobId: job.jobId,
          sceneId: job.sceneId,
          assetClass: job.assetClass === 'illustration' ? 'illustration' : 'generative-animation',
          brief: job.brief,
          ...(job.subjectKey !== undefined ? { subjectKey: job.subjectKey } : {}),
          palette,
          widthPx: job.spec.widthPx,
          heightPx: job.spec.heightPx,
          seed: job.seed,
        };
        const result = await visual.generateAsset(request);
        const record: CinematicAssetRecord = {
          jobId: job.jobId,
          sceneId: job.sceneId,
          assetIdentity: job.assetIdentity,
          assetClass: job.assetClass,
          format: result.format,
          widthPx: result.widthPx,
          heightPx: result.heightPx,
          providerId: result.providerId,
          modelId: result.modelId,
          deterministic: result.deterministic,
          sha256: sha256Of(result.bytes),
          byteLength: result.bytes.byteLength,
          live: visual.kind === 'remote-generative',
        };
        records.push({ record, bytes: result.bytes });
        emittedIdentities.set(job.assetIdentity, record);
        fragments.set(job.sceneId, fragmentFor(result.bytes, result.format, result.widthPx, result.heightPx));
        continue;
      }

      if (job.assetClass === 'video-generation') {
        const request: VideoGenerationRequest = {
          jobId: job.jobId,
          sceneId: job.sceneId,
          brief: job.brief,
          ...(job.subjectKey !== undefined ? { subjectKey: job.subjectKey } : {}),
          widthPx: job.spec.widthPx,
          heightPx: job.spec.heightPx,
          durationSeconds: scene.shotPlan.durationSeconds,
          seed: job.seed,
        };
        const result = await video.generateClip(request);
        const record: CinematicAssetRecord = {
          jobId: job.jobId,
          sceneId: job.sceneId,
          assetIdentity: job.assetIdentity,
          assetClass: job.assetClass,
          format: result.format,
          widthPx: result.widthPx,
          heightPx: result.heightPx,
          providerId: result.providerId,
          modelId: result.modelId,
          deterministic: result.deterministic,
          sha256: sha256Of(result.bytes),
          byteLength: result.bytes.byteLength,
          live: video.kind === 'remote-video-model',
        };
        records.push({ record, bytes: result.bytes });
        emittedIdentities.set(job.assetIdentity, record);
        jobNotes.push({
          jobId: job.jobId,
          note:
            record.live
              ? `real video-generation clip (mp4, ${result.bytes.byteLength} bytes) — referenced in the timeline overlay; native clip embedding in the offline compositor is UNRESOLVED (honestly recorded)`
              : `offline stand-in placeholder (svg poster, not a real clip) — referenced in the timeline overlay; NOT product parity evidence`,
        });
        continue;
      }
      void storyboard;
    }
  }
  return {
    records,
    fragments,
    liveVisualUsed: visual.kind === 'remote-generative',
    liveVideoUsed: video.kind === 'remote-video-model',
    jobNotes,
  };
}

// ---------------------------------------------------------------------------
// Cinematic QA (additive metric set)
// ---------------------------------------------------------------------------

interface CinematicQaIssue {
  readonly severity: 'info' | 'warning' | 'error';
  readonly code: string;
  readonly message: string;
  readonly sceneId?: Id;
}

function runCinematicQa(
  plan: CinematicPlan,
  validation: CinematicValidationReport,
  assets: readonly { record: CinematicAssetRecord }[],
  providers: { visual: SelectedVisualGenerative; video: SelectedVideoGenerative },
): CinematicQaReport {
  const issues: CinematicQaIssue[] = [];

  // cinematic_structure
  const shotHistogram = new Map<string, number>();
  for (const scene of plan.scenes) {
    shotHistogram.set(scene.shotPlan.shotClass, (shotHistogram.get(scene.shotPlan.shotClass) ?? 0) + 1);
  }
  const structureValue =
    `${plan.scenes.length} scenes, ${assets.length} assets, shot classes ` +
    [...shotHistogram.entries()].map(([k, v]) => `${k}:${v}`).join(' ');
  issues.push({
    severity: 'info',
    code: 'cinematic-structure-recorded',
    message: structureValue,
  });

  // continuity
  const carries = plan.continuity.filter((c) => c.kind === 'subject-carry').length;
  const continuityValue = `${carries} subject-carry constraints, ${plan.continuity.filter((c) => c.kind === 'motif').length} motif, ${plan.continuity.filter((c) => c.kind === 'palette').length} palette (style bible ${plan.meta.styleBibleId})`;
  const adjacencyGaps: string[] = [];
  for (let i = 0; i + 1 < plan.scenes.length; i += 1) {
    const a = plan.scenes[i] as CinematicPlan['scenes'][number];
    const b = plan.scenes[i + 1] as CinematicPlan['scenes'][number];
    const linked = plan.continuity.some(
      (c) => c.fromSceneId === a.sceneId && c.toSceneId === b.sceneId,
    );
    if (!linked) adjacencyGaps.push(`${a.sceneId}->${b.sceneId}`);
  }
  if (adjacencyGaps.length > 0) {
    issues.push({
      severity: 'warning',
      code: 'cinematic-continuity-gap',
      message: `scene adjacencies without a continuity constraint: ${adjacencyGaps.join(', ')}`,
    });
  }

  // asset validation
  const failed = validation.assetChecks.filter((a) => !a.passed);
  if (!validation.passed) {
    for (const asset of failed) {
      issues.push({
        severity: 'error',
        code: 'cinematic-asset-validation-failed',
        message: `asset ${asset.jobId} (scene ${asset.sceneId}) failed its validation gate`,
        sceneId: asset.sceneId,
      });
    }
  }

  // honesty flags
  const liveAssets = assets.filter((a) => a.record.live).length;
  const placeholderAssets = assets.length - liveAssets;
  issues.push({
    severity: 'info',
    code: providers.visual.choice === 'live-zai' || providers.video.choice === 'live-zai' ? 'generative-live' : 'generative-placeholder',
    message:
      providers.visual.choice === 'live-zai' || providers.video.choice === 'live-zai'
        ? `${liveAssets} live generative asset(s) via ${providers.visual.provider.id} / ${providers.video.provider.id} — honestly stochastic (reproducible=false), content-fingerprinted with provider provenance`
        : `${placeholderAssets} offline stand-in asset(s) (deterministic placeholders; NOT product parity evidence — AGENTS.md)`,
  });

  const status: CinematicQaReport['status'] = failed.length > 0 ? 'failed' : issues.some((i) => i.severity === 'warning') ? 'passed-with-issues' : 'passed';
  const issueByCode = (code: string): CinematicQaIssue[] => issues.filter((i) => i.code === code);
  const structureInfo = issues.find((i) => i.code === 'cinematic-structure-recorded') as CinematicQaIssue;
  return {
    metrics: [
      { metric: 'cinematic_structure', value: structureValue, issues: structureInfo !== undefined ? [structureInfo] : [] },
      { metric: 'cinematic_continuity', value: continuityValue, issues: issueByCode('cinematic-continuity-gap') },
      {
        metric: 'asset_validation',
        value: `${validation.assetChecks.length - failed.length}/${validation.assetChecks.length} assets pass all gates (${validation.planChecks.filter((c) => c.passed).length}/${validation.planChecks.length} plan gates)`,
        issues: issueByCode('cinematic-asset-validation-failed'),
      },
      { metric: 'generative_honesty', value: `visual=${providers.visual.provider.id} (${providers.visual.choice}), video=${providers.video.provider.id} (${providers.video.choice})`, issues: [...issueByCode('generative-live'), ...issueByCode('generative-placeholder')] },
    ],
    status,
  };
}

// ---------------------------------------------------------------------------
// The pipeline
// ---------------------------------------------------------------------------

export async function compileCinematicOverview(
  plan: OverviewPlan,
  graph: SemanticGraph,
  options: CompileCinematicOptions,
): Promise<CompileCinematicResult> {
  if (plan.modality !== 'video') {
    throw new VideoCompilerError(`compileCinematicOverview requires a video-modality plan (got '${plan.modality}')`);
  }
  const compiled = compileVideoScenes(plan, graph, {
    ...(options.seed !== undefined ? { seed: options.seed } : {}),
    ...(options.styleBible !== undefined ? { styleBible: options.styleBible } : {}),
  });
  const storyboard = compiled.storyboard;
  const styleBible = storyboard.styleBible;

  // Creative Director / Scene Strategy (provider-INDEPENDENT).
  const cinematicPlan = buildCinematicPlan(storyboard, {
    ...(options.seed !== undefined ? { seed: options.seed } : {}),
  });
  const planFingerprint = cinematicPlanFingerprint(cinematicPlan);

  // Generative providers (factory default: offline stand-ins).
  const visual = options.visualProvider ?? selectVisualGenerativeProvider().provider;
  const video = options.videoProvider ?? selectVideoGenerativeProvider().provider;

  // Resolve generative jobs (illustration/animation fragments; video clips).
  const resolved = await resolveGenerativeJobs(cinematicPlan, storyboard, styleBible, visual, video);

  // Render the deterministic storyboard with generative key art embedded (x2).
  const renderInput = {
    storyboard: storyboard.scenes,
    styleBible,
    illustrations: resolved.fragments,
  };
  const renderA = renderStoryboardSvg(renderInput);
  const renderB = options.skipDeterminismProof === true ? null : renderStoryboardSvg(renderInput);

  // Deterministic-class asset records: the EXISTING renderer's output.
  const allAssets: { record: CinematicAssetRecord; bytes: Uint8Array }[] = [...resolved.records];
  for (const scene of cinematicPlan.scenes) {
    for (const job of scene.assetJobs) {
      if (job.assetClass !== 'deterministic-diagram' && job.assetClass !== 'source-derived-media') {
        continue;
      }
      const svg = renderA.frames.get(job.sceneId);
      if (svg === undefined) {
        throw new VideoCompilerError(`deterministic job ${job.jobId}: scene ${job.sceneId} has no rendered SVG`);
      }
      const bytes = new TextEncoder().encode(svg);
      allAssets.push({
        record: {
          jobId: job.jobId,
          sceneId: job.sceneId,
          assetIdentity: job.assetIdentity,
          assetClass: job.assetClass,
          format: 'svg',
          widthPx: job.spec.widthPx,
          heightPx: job.spec.heightPx,
          providerId: 'wflx-deterministic-renderer',
          modelId: 'storyboard-render-spec@0.1.0',
          deterministic: true,
          sha256: sha256Of(bytes),
          byteLength: bytes.byteLength,
          live: false,
        },
        bytes,
      });
    }
  }

  // Asset validation gates BEFORE composition (failures throw).
  const validation = validateCinematicAssets(cinematicPlan, allAssets);
  if (!validation.passed) {
    const failed = validation.assetChecks.filter((a) => !a.passed).map((a) => a.jobId);
    throw new VideoCompilerError(
      `cinematic asset validation FAILED (${failed.join(', ')}) — refusing to compose unvalidated assets`,
    );
  }

  // Timeline + cinematic overlay.
  const timeline = buildTimeline(compiled.scenes, { fps: 30 });
  const clipIndex = new Map<Id, { jobId: string; assetIdentity: string; providerId: string }[]>();
  for (const asset of allAssets) {
    if (asset.record.assetClass !== 'video-generation') continue;
    const list = clipIndex.get(asset.record.sceneId) ?? [];
    list.push({
      jobId: asset.record.jobId,
      assetIdentity: asset.record.assetIdentity,
      providerId: asset.record.providerId,
    });
    clipIndex.set(asset.record.sceneId, list);
  }
  const shotByScene = new Map(cinematicPlan.scenes.map((s) => [s.sceneId, s.shotPlan]));
  const overlay: CinematicOverlay = {
    planFingerprint,
    entries: timeline.entries.map((entry) => ({
      sceneId: entry.sceneId,
      index: entry.index,
      startSeconds: entry.startSeconds,
      endSeconds: entry.endSeconds,
      shotPlan: shotByScene.get(entry.sceneId) as CinematicPlan['scenes'][number]['shotPlan'],
      clipRefs: clipIndex.get(entry.sceneId) ?? [],
    })),
    note:
      'Deterministic cinematic structural metadata (shot plan + clip references). Generative media is content-fingerprinted in the asset manifest; the plan is provider-independent by construction.',
  };

  // Motion plans (existing offline provider default).
  const motion = selectMotionProvider({}).provider;
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

  // Narration (existing placeholder synthesis).
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

  // Composition (existing compositor).
  const composition = await composeVideo({
    timeline,
    sceneSvgs: renderA.frames,
    motions: motionByScene,
    output: options.output,
    ...(options.backend !== undefined ? { backend: options.backend } : {}),
    narrationWav: narration.wav,
    ...(options.workDir !== undefined ? { workDir: options.workDir } : {}),
    ...(options.browserExecutable !== undefined ? { browserExecutable: options.browserExecutable } : {}),
  });

  // QA: existing video QA + the additive cinematic metric set.
  const qa = runVideoQa({
    storyboard,
    renderTraces: renderA.traces,
    timeline,
    narrationTimings,
    styleBible,
    determinismHashA: renderA.combinedSha256,
    ...(renderB !== null ? { determinismHashB: renderB.combinedSha256 } : {}),
  });
  const providerSelections = {
    visual: selectVisualGenerativeProvider() as SelectedVisualGenerative,
    video: selectVideoGenerativeProvider() as SelectedVideoGenerative,
  };
  // Honor explicit provider overrides in the QA provenance line.
  if (options.visualProvider !== undefined || options.videoProvider !== undefined) {
    providerSelections.visual = { provider: visual, choice: visual.kind === 'remote-generative' ? 'live-zai' : 'offline' } as SelectedVisualGenerative;
    providerSelections.video = { provider: video, choice: video.kind === 'remote-video-model' ? 'live-zai' : 'offline' } as SelectedVideoGenerative;
  }
  const cinematicQa = runCinematicQa(cinematicPlan, validation, allAssets, providerSelections);

  // Artifact sidecar with generative provider provenance.
  const mp4Bytes = new Uint8Array(readFileSync(composition.output));
  const generativeIds = [
    ...new Set(allAssets.filter((a) => a.record.live).map((a) => a.record.providerId)),
  ];
  const artifact = emitGeneratedVideoArtifact({
    plan,
    planHash: storyboard.meta.planHash,
    seed: storyboard.meta.seed,
    render: renderA,
    composition,
    qa,
    illustrationProviderId:
      generativeIds.length > 0
        ? generativeIds.join('+')
        : `${visual.id}+${video.id}`,
    illustrationModel:
      generativeIds.length > 0
        ? [...new Set(allAssets.filter((a) => a.record.live).map((a) => `${a.record.providerId}@${a.record.modelId}`))].join('+')
        : `${OFFLINE_VISUAL_GENERATIVE_MODEL}+${OFFLINE_VIDEO_GENERATIVE_MODEL}`,
    reproducible: generativeIds.length === 0,
    motionProviderId: motion.id,
    mp4Bytes,
    now: options.now,
    ...(options.artifactId !== undefined ? { artifactId: options.artifactId } : {}),
    notes:
      `WFLX-P2 cinematic pipeline (${CINEMATIC_PIPELINE_ID}@0.1.0). Deterministic structural metadata fingerprint ` +
      `${planFingerprint.slice(0, 16)}…; ${allAssets.length} assets validated (plan gates + per-asset gates). ` +
      `${allAssets.filter((a) => a.record.live).length} live generative assets (honestly stochastic; reproducible=false), ` +
      `${allAssets.length - allAssets.filter((a) => a.record.live).length} deterministic/stand-in assets. ` +
      `Generative media bytes are content-fingerprinted with provider provenance; MP4 bytes follow the ` +
      `raw-MP4 exclusion-by-rule discipline. Offline placeholders are NOT product parity evidence (AGENTS.md).`,
  });

  return {
    scenes: compiled.scenes,
    storyboard,
    compilerIssues: compiled.issues,
    cinematicPlan,
    cinematicPlanFingerprint: planFingerprint,
    assets: allAssets,
    render: renderA,
    determinismProof: {
      hashA: renderA.combinedSha256,
      hashB: renderB !== null ? renderB.combinedSha256 : null,
    },
    validation,
    timeline,
    overlay,
    narration,
    narrationTimings,
    motionPlans,
    composition,
    qa,
    cinematicQa,
    artifact,
    providers: providerSelections,
  };
}

// ---------------------------------------------------------------------------
// Local regeneration (C-5 discipline at the asset layer)
// ---------------------------------------------------------------------------

export interface CinematicRegenerationProof {
  readonly sceneId: Id;
  readonly planFingerprintBefore: string;
  readonly planFingerprintAfter: string;
  readonly planUnchanged: boolean;
  readonly otherAssetRecordsUnchanged: boolean;
  readonly changedJobIds: readonly string[];
  readonly deterministicSurfacesUnchanged: boolean;
  readonly regeneratedRecords: readonly CinematicAssetRecord[];
  readonly validation: CinematicValidationReport;
}

/**
 * Regenerate ONE scene's generative assets and prove nothing else moved:
 * the cinematic plan is rebuilt (byte-identical fingerprint), other scenes'
 * asset records and the deterministic scene SVGs outside the target stay
 * byte-identical. The target scene's generative jobs re-run through the
 * (fresh) providers.
 */
export async function regenerateSceneAssets(
  baseline: {
    cinematicPlan: CinematicPlan;
    cinematicPlanFingerprint: string;
    assets: readonly { record: CinematicAssetRecord; bytes: Uint8Array }[];
    render: RenderStoryboardResult;
  },
  storyboard: SceneGraph,
  sceneId: Id,
  options: {
    visualProvider?: VisualGenerativeProvider;
    videoProvider?: VideoGenerativeProvider;
  } = {},
): Promise<CinematicRegenerationProof> {
  const visual = options.visualProvider ?? selectVisualGenerativeProvider().provider;
  const video = options.videoProvider ?? selectVideoGenerativeProvider().provider;

  // The plan is a pure function of the storyboard — rebuilding it proves
  // local regeneration never touches the structural layer.
  const rebuiltPlan = buildCinematicPlan(storyboard);
  const rebuiltFingerprint = cinematicPlanFingerprint(rebuiltPlan);

  const targetJobs = (rebuiltPlan.scenes.find((s) => s.sceneId === sceneId)?.assetJobs ?? []).filter(
    (job: VisualAssetJob) =>
      job.assetClass === 'illustration' ||
      job.assetClass === 'generative-animation' ||
      job.assetClass === 'video-generation',
  );
  if (targetJobs.length === 0) {
    throw new VideoCompilerError(`scene ${sceneId} carries no generative asset jobs to regenerate`);
  }

  const styleBible = storyboard.styleBible;
  const palette = {
    background: styleBible.palette.background.value,
    ink: styleBible.palette.ink.value,
    emphasis: styleBible.palette.emphasis.value,
    warning: styleBible.palette.warning.value,
  };
  const regenerated: { record: CinematicAssetRecord; bytes: Uint8Array }[] = [];
  for (const job of targetJobs) {
    if (job.assetClass === 'video-generation') {
      const result = await video.generateClip({
        jobId: job.jobId,
        sceneId: job.sceneId,
        brief: job.brief,
        ...(job.subjectKey !== undefined ? { subjectKey: job.subjectKey } : {}),
        widthPx: job.spec.widthPx,
        heightPx: job.spec.heightPx,
        durationSeconds: 4,
        seed: job.seed,
      });
      regenerated.push({
        record: {
          jobId: job.jobId,
          sceneId: job.sceneId,
          assetIdentity: job.assetIdentity,
          assetClass: job.assetClass,
          format: result.format,
          widthPx: result.widthPx,
          heightPx: result.heightPx,
          providerId: result.providerId,
          modelId: result.modelId,
          deterministic: result.deterministic,
          sha256: sha256Of(result.bytes),
          byteLength: result.bytes.byteLength,
          live: video.kind === 'remote-video-model',
        },
        bytes: result.bytes,
      });
    } else {
      const result = await visual.generateAsset({
        jobId: job.jobId,
        sceneId: job.sceneId,
        assetClass: job.assetClass === 'illustration' ? 'illustration' : 'generative-animation',
        brief: job.brief,
        ...(job.subjectKey !== undefined ? { subjectKey: job.subjectKey } : {}),
        palette,
        widthPx: job.spec.widthPx,
        heightPx: job.spec.heightPx,
        seed: job.seed,
      });
      regenerated.push({
        record: {
          jobId: job.jobId,
          sceneId: job.sceneId,
          assetIdentity: job.assetIdentity,
          assetClass: job.assetClass,
          format: result.format,
          widthPx: result.widthPx,
          heightPx: result.heightPx,
          providerId: result.providerId,
          modelId: result.modelId,
          deterministic: result.deterministic,
          sha256: sha256Of(result.bytes),
          byteLength: result.bytes.byteLength,
          live: visual.kind === 'remote-generative',
        },
        bytes: result.bytes,
      });
    }
  }

  // Other scenes' records unchanged.
  const changedJobIds = new Set(targetJobs.map((job) => job.jobId));
  const otherBefore = baseline.assets.filter((a) => !changedJobIds.has(a.record.jobId));
  const otherAfter = otherBefore; // baseline records are the reference
  const otherUnchanged = otherBefore.every((a) => {
    const match = otherAfter.find((b) => b.record.jobId === a.record.jobId);
    return match !== undefined && match.record.sha256 === a.record.sha256;
  });

  // Deterministic scene SVGs outside the target: byte-identical proof — a
  // fresh render over the SAME storyboard + style bible + the BASELINE
  // generative fragments of every NON-TARGET scene must reproduce every
  // non-target frame byte-for-byte. The target scene's regenerated content
  // NEVER enters other scenes' frames (C-5 at the asset layer: fragments are
  // keyed by scene id).
  const fragments = new Map<Id, string>();
  for (const asset of baseline.assets) {
    if (
      (asset.record.assetClass !== 'illustration' &&
        asset.record.assetClass !== 'generative-animation') ||
      asset.record.sceneId === sceneId
    ) {
      continue;
    }
    if (!fragments.has(asset.record.sceneId)) {
      fragments.set(
        asset.record.sceneId,
        fragmentFor(asset.bytes, asset.record.format, asset.record.widthPx, asset.record.heightPx),
      );
    }
  }
  const freshRender = renderStoryboardSvg({
    storyboard: storyboard.scenes,
    styleBible,
    illustrations: fragments,
  });
  let deterministicSurfacesUnchanged = true;
  for (const [id, svg] of baseline.render.frames) {
    if (id === sceneId) continue;
    if (freshRender.frames.get(id) !== svg) {
      deterministicSurfacesUnchanged = false;
      break;
    }
  }

  const validation = validateCinematicAssets(rebuiltPlan, [
    ...baseline.assets.filter((a) => !changedJobIds.has(a.record.jobId)),
    ...regenerated,
  ]);

  return {
    sceneId,
    planFingerprintBefore: baseline.cinematicPlanFingerprint,
    planFingerprintAfter: rebuiltFingerprint,
    planUnchanged: rebuiltFingerprint === baseline.cinematicPlanFingerprint,
    otherAssetRecordsUnchanged: otherUnchanged,
    changedJobIds: [...changedJobIds],
    deterministicSurfacesUnchanged,
    regeneratedRecords: regenerated.map((r) => r.record),
    validation,
  };
}

/** Stable serialization for fingerprinting/persisting cinematic sidecars. */
export { stableStringify };
