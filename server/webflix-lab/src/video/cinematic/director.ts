/**
 * Video pipeline (WFLX-P2, Deliverable C1) — the CinematicDirector.
 *
 * Scene strategy over the EXISTING OverviewPlan (per the frozen
 * architecture §2 Cinematic target shape):
 * - continuity-aware scene planning: subject-carry constraints between
 *   consecutive scenes sharing grounded subjects; palette continuity always;
 * - camera/motion planning: a deterministic shot-plan vector per scene
 *   (shot class, camera move, pace) keyed on the C-5 scene-local content
 *   hash — never a wall clock or global RNG state;
 * - style continuity: StyleBible-derived cinematic parameters (pace band,
 *   allowed camera moves filtered by the bible's motion grammar);
 * - asset reuse: the same subject reuses its asset identity across scenes
 *   (one asset identity per subject key; jobs reference identities, so a
 *   repeated subject regenerates/reuses ONE asset, not many).
 *
 * The VisualAssetPlan layer is emitted here too: per-scene jobs typed by
 * the five frozen classes. Deterministic diagrams/labels stay on the
 * EXISTING deterministic renderer (the storyboard render spec is referenced,
 * never re-generated); generative jobs carry provider-neutral briefs.
 *
 * Determinism: pure function of (storyboard, options). The provider NEVER
 * enters this module (EV-022 F2: the plan is provider-independent).
 */

import { createHash } from 'node:crypto';
import { unitContentHash } from '../../contracts';
import { fnv1a32 } from '../rng';
import { stableStringify } from '../storyboard/compiler';
import type { SceneGraph, StoryboardScene } from '../storyboard/types';
import type { StyleBible } from '../style-bible';
import type {
  CameraMove,
  CinematicPlan,
  CinematicSceneStrategy,
  ContinuityConstraint,
  ShotClass,
  ShotPace,
  VisualAssetJob,
} from './types';

export const CINEMATIC_DIRECTOR_ID = 'wflx-cinematic-director';

/** StyleBible-derived cinematic parameters (style continuity). */
export interface CinematicStyleParams {
  readonly allowedCameraMoves: readonly CameraMove[];
  readonly defaultPace: ShotPace;
  readonly paceSeconds: { readonly slow: number; readonly measured: number; readonly brisk: number };
  readonly crossfadeSeconds: number;
}

/** Derive the cinematic parameters from the active StyleBible (pure). */
export function cinematicParamsFor(styleBible: StyleBible): CinematicStyleParams {
  const base: CameraMove[] = ['hold', 'push-in', 'pull-back', 'pan-left', 'pan-right'];
  if (styleBible.motion.allowedMotions.includes('parallax')) base.push('orbit');
  if (styleBible.motion.allowedMotions.includes('animated-diagram')) base.push('crane-up');
  return {
    allowedCameraMoves: base,
    defaultPace: styleBible.pacing.medianSceneSeconds > 8 ? 'slow' : 'measured',
    paceSeconds: {
      slow: Math.max(8, styleBible.pacing.maxSceneSeconds),
      measured: styleBible.pacing.medianSceneSeconds,
      brisk: Math.max(2, styleBible.pacing.minSceneSeconds),
    },
    crossfadeSeconds: styleBible.motion.transitionSeconds,
  };
}

const CAMERA_BY_MOTION: Record<string, CameraMove> = {
  static: 'hold',
  pan: 'pan-right',
  zoom: 'push-in',
  parallax: 'orbit',
  'animated-diagram': 'crane-up',
};

function shotClassFor(
  scene: StoryboardScene,
  position: { first: boolean; last: boolean; beatIndex: number },
): ShotClass {
  if (position.first) return 'establishing';
  if (position.last) return 'outro';
  if (scene.render.layoutKind === 'diagram' || scene.render.layoutKind === 'flow' || scene.render.layoutKind === 'chart') {
    return 'diagram-reveal';
  }
  if (scene.render.layoutKind === 'illustration' || scene.render.layoutKind === 'montage') {
    return 'motion-beat';
  }
  return position.beatIndex % 2 === 0 ? 'hero' : 'detail';
}

function paceFor(durationSeconds: number, params: CinematicStyleParams): ShotPace {
  if (durationSeconds >= params.paceSeconds.slow) return 'slow';
  if (durationSeconds <= params.paceSeconds.brisk * 1.5) return 'brisk';
  return params.defaultPace === 'slow' ? 'measured' : params.defaultPace;
}

/** Dominant subject key for one scene (grounded entity, else content hash). */
export function subjectKeyFor(scene: StoryboardScene): string {
  const entity = scene.grounding.entities[0];
  if (entity !== undefined) return `subject:${entity.name}`;
  return `subject:scene-${scene.scene.id}`;
}

/** Stable asset identity for a subject key (reuse across scenes). */
export function assetIdentityFor(subjectKey: string): string {
  return `asset-${fnv1a32(subjectKey).toString(16).padStart(8, '0')}`;
}

/**
 * The C-5 cinematic stochastic key: seed + scene-local content hash +
 * cinematic surface. Identical composition discipline as the storyboard
 * compiler's scene key (src/contracts/unit-content-hash.ts).
 */
function cinematicKeyFor(scene: StoryboardScene, seed: string): string {
  const sceneHash = unitContentHash([
    scene.scene.narrativePurpose,
    scene.scene.narrationBrief,
    scene.scene.visualBrief ?? '',
    ...scene.grounding.claimStatements,
    ...scene.scene.exactTexts.map((item) => `${item.role}:${item.value}`),
  ]);
  return `${seed}|${sceneHash}|cinematic|${scene.scene.id}`;
}

const DETERMINISTIC_CLASSES = new Set([
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

const SOURCE_DERIVED_CLASSES = new Set(['quote-panel', 'callout']);

export interface BuildCinematicPlanOptions {
  /** Deterministic seed; defaults to the storyboard's seed. */
  readonly seed?: string;
}

/** Build the cinematic plan (scene strategies + asset plan) — pure. */
export function buildCinematicPlan(
  storyboard: SceneGraph,
  options: BuildCinematicPlanOptions = {},
): CinematicPlan {
  const seed = options.seed ?? storyboard.meta.seed;
  const styleBible = storyboard.styleBible;
  const params = cinematicParamsFor(styleBible);
  const beats = new Map(storyboard.plan.beats.map((beat) => [beat.id, beat]));

  const scenes: CinematicSceneStrategy[] = [];
  let generativeOrdinalCounter = 0;
  for (const [index, scene] of storyboard.scenes.entries()) {
    const key = cinematicKeyFor(scene, seed);
    const beat = scene.scene.beatId !== undefined ? beats.get(scene.scene.beatId) : undefined;
    const first = index === 0;
    const last = index === storyboard.scenes.length - 1;
    void last;

    const shotClass = shotClassFor(scene, { first, last, beatIndex: beat?.index ?? index });
    const camera = pickCamera(scene, shotClass, key, params);
    const pace = paceFor(scene.scene.targetDurationSeconds, params);

    const entrySubject = subjectKeyFor(scene);
    // Exit subject: the NEXT scene's subject when they share grounding
    // (continuity hand-off), else this scene's own subject.
    const next = storyboard.scenes[index + 1];
    const nextSubject = next !== undefined ? subjectKeyFor(next) : entrySubject;
    const sharesSubject =
      next !== undefined &&
      next.grounding.entities.some((e) =>
        scene.grounding.entities.some((p) => p.id === e.id),
      );
    const exitSubject = sharesSubject ? nextSubject : entrySubject;

    const subjectKey = entrySubject;
    const isGenerative =
      scene.scene.renderingClass === 'generative' ||
      scene.scene.renderingClass === 'hybrid' ||
      scene.render.layoutKind === 'illustration' ||
      scene.render.layoutKind === 'montage';
    const generativeOrdinal = isGenerative ? generativeOrdinalCounter++ : -1;
    scenes.push({
      sceneId: scene.scene.id,
      index,
      shotPlan: {
        sceneId: scene.scene.id,
        shotClass,
        cameraMove: camera,
        pace,
        durationSeconds: scene.scene.targetDurationSeconds,
        seed: key,
      },
      entrySubjectKey: entrySubject,
      exitSubjectKey: exitSubject,
      assetIdentity: assetIdentityFor(subjectKey),
      assetJobs: assetJobsFor(scene, key, subjectKey, styleBible, {
        shotClass,
        generativeOrdinal,
      }),
    });
  }

  // Continuity constraints: subject-carry on shared grounding (entities, or
  // the shared claim's subject when entities are disjoint); motif otherwise;
  // palette always.
  const continuity: ContinuityConstraint[] = [];
  storyboard.scenes.forEach((scene, index) => {
    const next = storyboard.scenes[index + 1];
    if (next === undefined) return;
    const sharedEntity = scene.grounding.entities.find((entity) =>
      next.grounding.entities.some((other) => other.id === entity.id),
    );
    if (sharedEntity !== undefined) {
      continuity.push({
        kind: 'subject-carry',
        fromSceneId: scene.scene.id,
        toSceneId: next.scene.id,
        key: `subject:${sharedEntity.name}`,
      });
    } else {
      const sharedClaim = scene.grounding.claims.find((claim) =>
        next.grounding.claims.some((other) => other.id === claim.id),
      );
      if (sharedClaim !== undefined) {
        continuity.push({
          kind: 'subject-carry',
          fromSceneId: scene.scene.id,
          toSceneId: next.scene.id,
          key: `subject:${sharedClaim.id}`,
        });
      } else {
        continuity.push({
          kind: 'motif',
          fromSceneId: scene.scene.id,
          toSceneId: next.scene.id,
          key: 'motif:cinematic-rhythm',
        });
      }
    }
  });
  for (const scene of storyboard.scenes) {
    continuity.push({
      kind: 'palette',
      fromSceneId: scene.scene.id,
      toSceneId: scene.scene.id,
      key: `palette:${styleBible.id}`,
    });
  }

  const plan: CinematicPlan = {
    meta: {
      planId: storyboard.meta.planId,
      planHash: storyboard.meta.planHash,
      mode: storyboard.meta.mode,
      seed,
      styleBibleId: styleBible.id,
      styleBibleVersion: styleBible.styleBibleVersion,
      compiler: `${CINEMATIC_DIRECTOR_ID}@0.1.0`,
      providerIndependent: true,
    },
    scenes,
    continuity,
  };
  return plan;
}

function pickCamera(
  scene: StoryboardScene,
  shotClass: ShotClass,
  key: string,
  params: CinematicStyleParams,
): CameraMove {
  const byMotion = CAMERA_BY_MOTION[scene.scene.motion] ?? 'hold';
  const allowed = (move: CameraMove): boolean => params.allowedCameraMoves.includes(move);
  if (shotClass === 'establishing') return allowed('crane-up') ? 'crane-up' : 'push-in';
  if (shotClass === 'outro') return 'pull-back';
  if (shotClass === 'diagram-reveal') return allowed(byMotion) ? byMotion : 'hold';
  if (shotClass === 'motion-beat') {
    // Seeded lateral choice (C-5 key) inside the allowed set.
    const lateral = (['pan-left', 'pan-right', 'orbit'] as CameraMove[]).filter(allowed);
    if (lateral.length > 0) {
      return lateral[fnv1a32(`${key}:camera`) % lateral.length] as CameraMove;
    }
  }
  return allowed(byMotion) ? byMotion : 'hold';
}

function assetJobsFor(
  scene: StoryboardScene,
  key: string,
  subjectKey: string,
  styleBible: StyleBible,
  position: { shotClass: ShotClass; generativeOrdinal: number },
): VisualAssetJob[] {
  const { widthPx, heightPx } = styleBible.layout;
  const visualType = scene.scene.visualType;
  const identity = assetIdentityFor(subjectKey);
  const jobs: VisualAssetJob[] = [];

  const brief = scene.render.illustrationBrief;

  if (DETERMINISTIC_CLASSES.has(visualType)) {
    if (SOURCE_DERIVED_CLASSES.has(visualType)) {
      // Source-derived media: content derives directly from source evidence
      // (quotes/callouts) — deterministic, plan-carried.
      jobs.push({
        jobId: `job-${scene.scene.id}-sdm`,
        sceneId: scene.scene.id,
        assetClass: 'source-derived-media',
        brief: `Source-derived panel for ${scene.scene.id}: exact texts ${scene.scene.exactTexts.map((t) => t.value).join(' | ')}`,
        assetIdentity: identity,
        seed: `${key}:sdm`,
        spec: { widthPx, heightPx, expectedFormat: 'svg' },
        deterministicContent: scene.render.quote ?? scene.scene.exactTexts.map((t) => t.value).join(' | '),
      });
    } else {
      // Deterministic diagram: the EXISTING renderer is authoritative.
      jobs.push({
        jobId: `job-${scene.scene.id}-det`,
        sceneId: scene.scene.id,
        assetClass: 'deterministic-diagram',
        brief: `Deterministic render spec for ${scene.scene.id} (${visualType}); exact labels authoritative on the existing renderer`,
        assetIdentity: identity,
        seed: `${key}:det`,
        spec: { widthPx, heightPx, expectedFormat: 'svg' },
        deterministicContent: scene.render.labels.join(' | ').slice(0, 200),
      });
    }
  }

  if (
    scene.scene.renderingClass === 'generative' ||
    scene.scene.renderingClass === 'hybrid' ||
    scene.render.layoutKind === 'illustration' ||
    scene.render.layoutKind === 'montage'
  ) {
    // Generative classes: pick video-generation vs animation vs still by
    // the scene's motion intent + its ordinal among generative scenes
    // (deterministic rule). The FIRST generative scene is the establishing
    // key art (a still illustration); later zoom/parallax shots become
    // video-generation jobs (cinematic motion shots); pan shots become
    // animated key art; everything else is a still illustration.
    const motion = scene.scene.motion;
    const wantsVideo =
      position.generativeOrdinal > 0 && (motion === 'zoom' || motion === 'parallax');
    const wantsAnimation = !wantsVideo && motion === 'pan';
    if (wantsVideo) {
      jobs.push({
        jobId: `job-${scene.scene.id}-vid`,
        sceneId: scene.scene.id,
        assetClass: 'video-generation',
        brief: `${brief} Cinematic motion shot (${position.shotClass}).`,
        ...(subjectKey !== undefined ? { subjectKey } : {}),
        assetIdentity: identity,
        seed: `${key}:vid`,
        spec: { widthPx, heightPx, expectedFormat: 'mp4' },
      });
    } else if (wantsAnimation) {
      jobs.push({
        jobId: `job-${scene.scene.id}-anim`,
        sceneId: scene.scene.id,
        assetClass: 'generative-animation',
        brief: `${brief} Animated key art with guided motion (${position.shotClass}).`,
        ...(subjectKey !== undefined ? { subjectKey } : {}),
        assetIdentity: identity,
        seed: `${key}:anim`,
        spec: { widthPx, heightPx, expectedFormat: 'svg' },
      });
    } else {
      jobs.push({
        jobId: `job-${scene.scene.id}-ill`,
        sceneId: scene.scene.id,
        assetClass: 'illustration',
        brief: `${brief} Still key art (${position.shotClass}).`,
        ...(subjectKey !== undefined ? { subjectKey } : {}),
        assetIdentity: identity,
        seed: `${key}:ill`,
        spec: { widthPx, heightPx, expectedFormat: 'svg' },
      });
    }
  }

  if (jobs.length === 0) {
    // Fallback (defensive — every visualType maps somewhere above).
    jobs.push({
      jobId: `job-${scene.scene.id}-det`,
      sceneId: scene.scene.id,
      assetClass: 'deterministic-diagram',
      brief: `Deterministic fallback render for ${scene.scene.id}`,
      assetIdentity: identity,
      seed: `${key}:det`,
      spec: { widthPx, heightPx, expectedFormat: 'svg' },
    });
  }
  return jobs;
}

/** Fingerprint the cinematic plan (deterministic structural metadata). */
export function cinematicPlanFingerprint(plan: CinematicPlan): string {
  return createHash('sha256').update(stableStringify(plan)).digest('hex');
}
