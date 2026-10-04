/**
 * Video pipeline (WFLX-P2, Deliverable C1) — the Cinematic asset-pipeline
 * types: the Creative Director / Scene Strategy layer over the existing
 * OverviewPlan (frozen architecture §2 target shape):
 *
 *   OverviewPlan -> Creative Director / Scene Strategy -> Visual Asset Plan
 *     (deterministic diagrams | illustrations | source-derived media |
 *      generative animation | video-generation jobs) -> Asset Validation
 *     -> Timeline / Composition -> QA -> Local regeneration
 *
 * Design boundaries (binding):
 * - DETERMINISTIC STRUCTURE: the cinematic plan (shot plans, scene
 *   strategies, asset identities, job specs, validation results) is a pure
 *   function of (storyboard, options) — fingerprinted via stableStringify.
 * - STOCHASTIC MEDIA, HONESTLY BOUNDED: generative asset BYTES come from
 *   providers (offline deterministic stand-in by default; live z-ai when
 *   env-gated). Media is content-fingerprinted (sha256) with provider
 *   provenance; byte-identity is claimed ONLY for the offline stand-in.
 * - DETERMINISTIC-AUTHORITATIVE SURFACES UNCHANGED: exact labels, numbers,
 *   relationships and diagrams stay on the EXISTING deterministic renderer
 *   (the storyboard's render specs are reused verbatim — never regenerated
 *   by a generative model).
 * - LOCAL REGENERATION: one scene's generative asset regenerates without
 *   touching any other scene's plan or deterministic surface (C-5 at the
 *   asset layer).
 */

import type { Id } from '../../contracts';

/** The five Visual Asset Plan classes (frozen architecture vocabulary). */
export type VisualAssetClass =
  | 'deterministic-diagram'
  | 'illustration'
  | 'source-derived-media'
  | 'generative-animation'
  | 'video-generation';

/** Cinematic shot classes (lab vocabulary over the observed grammar). */
export type ShotClass =
  | 'establishing'
  | 'detail'
  | 'diagram-reveal'
  | 'motion-beat'
  | 'hero'
  | 'outro';

/** Cinematic camera moves (extends the contract motion vocabulary). */
export type CameraMove =
  | 'hold'
  | 'push-in'
  | 'pull-back'
  | 'pan-left'
  | 'pan-right'
  | 'crane-up'
  | 'orbit';

/** Scene pacing. */
export type ShotPace = 'slow' | 'measured' | 'brisk';

/** The deterministic shot-plan vector for one scene. */
export interface ShotPlan {
  readonly sceneId: Id;
  readonly shotClass: ShotClass;
  readonly cameraMove: CameraMove;
  readonly pace: ShotPace;
  readonly durationSeconds: number;
  /** Stochastic key (C-5 scene-local content hash composition). */
  readonly seed: string;
}

/** Scene-to-scene continuity constraint. */
export interface ContinuityConstraint {
  readonly kind: 'subject-carry' | 'palette' | 'motif';
  readonly fromSceneId: Id;
  readonly toSceneId: Id;
  /** Subject/motif key (subject-carry / motif); palette carries the bible id. */
  readonly key: string;
}

/** One scene's creative-director strategy. */
export interface CinematicSceneStrategy {
  readonly sceneId: Id;
  readonly index: number;
  readonly shotPlan: ShotPlan;
  /** Subject entering the scene (continuity anchor). */
  readonly entrySubjectKey: string;
  /** Subject leaving the scene (continuity anchor). */
  readonly exitSubjectKey: string;
  /** Asset identity reused across scenes for the same subject. */
  readonly assetIdentity: string;
  /** Asset jobs for this scene (>= 1). */
  readonly assetJobs: readonly VisualAssetJob[];
}

/** One job in the Visual Asset Plan. */
export interface VisualAssetJob {
  readonly jobId: string;
  readonly sceneId: Id;
  readonly assetClass: VisualAssetClass;
  /** Provider-neutral brief (deterministic source or generative prompt). */
  readonly brief: string;
  /** Subject key for continuity/reuse (generative jobs). */
  readonly subjectKey?: string;
  /** Asset identity (reuse: same subject -> same identity). */
  readonly assetIdentity: string;
  /** Deterministic seed (C-5 composition). */
  readonly seed: string;
  /** Spec the asset must satisfy at validation. */
  readonly spec: {
    readonly widthPx: number;
    readonly heightPx: number;
    readonly expectedFormat: 'svg' | 'png' | 'jpeg' | 'mp4';
  };
  /** Deterministic content produced in-plan (deterministic classes). */
  readonly deterministicContent?: string;
}

/** The full cinematic plan over one storyboard. */
export interface CinematicPlan {
  readonly meta: {
    readonly planId: Id;
    readonly planHash: string;
    readonly mode: string;
    readonly seed: string;
    readonly styleBibleId: Id;
    readonly styleBibleVersion: string;
    readonly compiler: string;
    /** Provider-independent by construction (EV-022 F2 anchor). */
    readonly providerIndependent: true;
  };
  readonly scenes: readonly CinematicSceneStrategy[];
  readonly continuity: readonly ContinuityConstraint[];
}

/** One resolved asset record (deterministic or generative). */
export interface CinematicAssetRecord {
  readonly jobId: string;
  readonly sceneId: Id;
  readonly assetIdentity: string;
  readonly assetClass: VisualAssetClass;
  readonly format: 'svg' | 'png' | 'jpeg' | 'mp4';
  readonly widthPx: number;
  readonly heightPx: number;
  readonly providerId: string;
  readonly modelId: string;
  readonly deterministic: boolean;
  readonly sha256: string;
  readonly byteLength: number;
  /** True when the bytes came from a live provider (honesty flag). */
  readonly live: boolean;
  /** Optional async task id (live video jobs). */
  readonly taskId?: string;
}

/** Per-asset validation outcome. */
export interface AssetValidationOutcome {
  readonly jobId: string;
  readonly sceneId: Id;
  readonly assetIdentity: string;
  readonly passed: boolean;
  readonly checks: readonly {
    readonly name: string;
    readonly passed: boolean;
    readonly detail: string;
  }[];
}

export interface CinematicValidationReport {
  readonly planChecks: readonly {
    readonly name: string;
    readonly passed: boolean;
    readonly detail: string;
  }[];
  readonly assetChecks: readonly AssetValidationOutcome[];
  readonly passed: boolean;
}

/** Cinematic QA (additive metric set over the existing video QA). */
export interface CinematicQaReport {
  readonly metrics: readonly {
    readonly metric: string;
    readonly value: string;
    readonly issues: readonly {
      readonly severity: 'info' | 'warning' | 'error';
      readonly code: string;
      readonly message: string;
      readonly sceneId?: Id;
    }[];
  }[];
  readonly status: 'passed' | 'passed-with-issues' | 'failed';
}
