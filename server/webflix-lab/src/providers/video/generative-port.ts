/**
 * Generative video provider port (WFLX-P2, Deliverable C) — the
 * provider-neutral boundary between the Cinematic asset pipeline
 * (src/video/cinematic) and video-generation backends.
 *
 * Serves the 'video-generation' asset class: native text-to-video jobs for
 * cinematic motion shots. Mirrors the visual generative port's binding
 * rules (provider-neutral, ambient auth, no faked output, honest
 * stochasticity for live adapters, offline default never changes).
 */

/** Neutral request for one generated video clip. */
export interface VideoGenerationRequest {
  readonly jobId: string;
  readonly sceneId: string;
  /** Provider-neutral creative brief for the motion shot. */
  readonly brief: string;
  readonly subjectKey?: string;
  readonly widthPx: number;
  readonly heightPx: number;
  /** Planned clip duration in seconds (advisory; providers may clamp). */
  readonly durationSeconds: number;
  /** Deterministic seed (C-5 scene-local content key). */
  readonly seed: string;
}

/** Neutral result for one generated video clip. */
export interface VideoGenerationResult {
  readonly jobId: string;
  readonly sceneId: string;
  /** Media bytes: 'mp4' for live providers; 'svg' for the offline stand-in
   * (a placeholder poster + motion metadata — honestly not a real clip). */
  readonly bytes: Uint8Array;
  readonly format: 'mp4' | 'svg';
  readonly widthPx: number;
  readonly heightPx: number;
  readonly providerId: string;
  readonly modelId: string;
  readonly deterministic: boolean;
  /** Actual clip duration in seconds, when the provider reports one. */
  readonly durationSeconds?: number;
}

export interface VideoGenerativeCapabilities {
  readonly remote: boolean;
  /** True when the provider produces real video media (live adapters). */
  readonly realClips: boolean;
}

export interface VideoGenerativeOptions {
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  /** Total poll budget for async task completion (live adapters). */
  readonly pollBudgetMs?: number;
  readonly env?: NodeJS.ProcessEnv;
}

/** The VideoGenerativeProvider port. */
export interface VideoGenerativeProvider {
  readonly id: string;
  readonly kind: 'offline-deterministic' | 'remote-video-model';

  capabilities(): VideoGenerativeCapabilities;

  requiredCredentialKeys(): readonly string[];

  /**
   * Generate one motion-shot clip. Throws typed errors on transport/provider
   * failure — never silently degrades.
   */
  generateClip(request: VideoGenerationRequest): Promise<VideoGenerationResult>;

  /** Optional liveness probe through the REAL service (live adapters). */
  healthCheck?(): Promise<{ ok: boolean; detail?: string }>;
}
