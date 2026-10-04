/**
 * Generative visual-asset port (WFLX-P2, Deliverable C) — the provider-neutral
 * boundary between the Cinematic asset pipeline (src/video/cinematic) and
 * generative image backends.
 *
 * Binding rules (mirroring the W3 illustration port + the P1 live-TTS
 * precedent):
 * - Provider-NEUTRAL: provider-specific request/response shapes live inside
 *   adapter files, never here.
 * - NO credentials in code: the z-ai SDK authenticates from the ambient
 *   runtime environment (operator/TL-side wiring); adapters declare NO
 *   required credential keys and never read, log or commit credential-shaped
 *   strings. Public, non-secret CONFIG (model id) may arrive via env.
 * - Offline adapters are DETERMINISTIC given the request (byte-identical
 *   regeneration) — the canonical test path needs no network, no keys.
 * - Live adapters NEVER fake output: transport/provider failures throw typed
 *   errors. Live output is honestly stochastic (deterministic: false).
 * - The OFFLINE DEFAULT never changes when env flags are unset.
 *
 * Asset classes routed to VISUAL generative providers:
 * - 'illustration' — still generated imagery for illustration scenes;
 * - 'generative-animation' — generated key art with parametric motion.
 * ('video-generation' routes to the VIDEO generative port.)
 */

/** The visual generative asset classes this port serves. */
export type VisualAssetClass = 'illustration' | 'generative-animation';

/** Palette projection for briefs (hex values from the active StyleBible). */
export interface VisualAssetPalette {
  readonly background: string;
  readonly ink: string;
  readonly emphasis: string;
  readonly warning: string;
}

/** Neutral request for one generative visual asset. */
export interface VisualAssetRequest {
  readonly jobId: string;
  readonly sceneId: string;
  readonly assetClass: VisualAssetClass;
  /** Provider-neutral creative brief (from the storyboard render spec). */
  readonly brief: string;
  /** Stable subject key for continuity/asset-reuse (deterministic). */
  readonly subjectKey?: string;
  readonly palette: VisualAssetPalette;
  readonly widthPx: number;
  readonly heightPx: number;
  /** Deterministic seed (C-5 scene-local content key). */
  readonly seed: string;
}

/** Neutral result for one generative visual asset. */
export interface VisualAssetResult {
  readonly jobId: string;
  readonly sceneId: string;
  /** Raw media bytes ('svg' fragment, 'png', or 'jpeg' raster). */
  readonly bytes: Uint8Array;
  readonly format: 'svg' | 'png' | 'jpeg';
  readonly widthPx: number;
  readonly heightPx: number;
  readonly providerId: string;
  /** Public model identity for provenance (no secrets). */
  readonly modelId: string;
  /** True only for deterministic offline adapters. */
  readonly deterministic: boolean;
}

export interface VisualGenerativeCapabilities {
  /** True when the provider reaches a real generative service. */
  readonly remote: boolean;
  /** Raster output (png/jpeg) vs vector fragments (svg). */
  readonly rasterOutput: boolean;
}

export interface VisualGenerativeOptions {
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  readonly env?: NodeJS.ProcessEnv;
}

/** The VisualGenerativeProvider port. */
export interface VisualGenerativeProvider {
  readonly id: string;
  readonly kind: 'offline-deterministic' | 'remote-generative';

  capabilities(): VisualGenerativeCapabilities;

  /** Env/config keys the adapter needs; always [] for this port (ambient auth). */
  requiredCredentialKeys(): readonly string[];

  /**
   * Generate one visual asset. Throws typed errors on transport/provider
   * failure — never silently degrades to placeholder output.
   */
  generateAsset(request: VisualAssetRequest): Promise<VisualAssetResult>;

  /** Optional liveness probe through the REAL service (live adapters). */
  healthCheck?(): Promise<{ ok: boolean; detail?: string }>;
}
