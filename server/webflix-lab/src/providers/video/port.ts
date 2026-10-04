/**
 * Motion/video provider port (WFLX-W3, OPTIONAL stage) — the provider-neutral
 * boundary between the compositor and motion backends.
 *
 * The lab's default path is PARAMETRIC MOTION ONLY: the deterministic adapter
 * plans camera moves (pan/zoom/parallax) as pure functions of the scene's
 * motion intent + seed, and the compositor applies them as transforms over
 * the deterministic scene frames. This honors the annotation finding that
 * motion is deliberate and rare (37/49 segments static) — motion adds
 * explanatory value, it is not ambient (AGENTS.md architecture rule).
 *
 * A remote video-generation adapter may additionally implement
 * `generateClip` for scenes where true generated motion adds explanatory
 * value; such adapters are env-gated, credential-safe, and never exercised by
 * the canonical test path.
 */

import type { SceneMotion } from '../../contracts';

/** Camera keyframe at one endpoint of a scene's motion. */
export interface CameraKeyframe {
  /** Translate in pixels from the rest position. */
  readonly dx: number;
  readonly dy: number;
  /** Uniform scale (1 = rest). */
  readonly scale: number;
}

/** Deterministic motion plan for one scene. */
export interface MotionPlan {
  readonly sceneId: string;
  readonly motion: SceneMotion;
  readonly from: CameraKeyframe;
  readonly to: CameraKeyframe;
  /** Easing identifier the compositor understands ('linear' | 'ease-in-out'). */
  readonly easing: 'linear' | 'ease-in-out';
  readonly providerId: string;
  readonly deterministic: boolean;
}

export interface MotionPlanRequest {
  readonly sceneId: string;
  readonly motion: SceneMotion;
  readonly seed: string;
  readonly durationSeconds: number;
  readonly canvasWidthPx: number;
  readonly canvasHeightPx: number;
}

export type MotionCredentialBag = Readonly<Record<string, string | undefined>>;

export interface MotionProviderOptions {
  readonly credentials?: MotionCredentialBag;
  readonly endpoint?: string;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
}

export interface MotionProviderCapabilities {
  /** Parametric camera plans (deterministic, no media bytes). */
  readonly parametricMotion: boolean;
  /** True when the provider can generate actual video clips. */
  readonly generatedClips: boolean;
  readonly remote: boolean;
}

/** The MotionProvider port. */
export interface MotionProvider {
  readonly id: string;
  readonly kind: 'offline-deterministic' | 'remote-video-model';

  capabilities(): MotionProviderCapabilities;

  /** Env/config keys the adapter needs; empty for offline adapters. */
  requiredCredentialKeys(): readonly string[];

  /** Plan the deterministic camera motion for one scene (always available). */
  planMotion(request: MotionPlanRequest): Promise<MotionPlan>;

  /**
   * OPTIONAL: generate a true motion clip for one scene (remote adapters).
   * Absent for the deterministic adapter by design.
   */
  generateClip?(
    request: MotionPlanRequest & { readonly brief: string },
  ): Promise<{ readonly mp4Base64: string; readonly deterministic: boolean }>;
}
