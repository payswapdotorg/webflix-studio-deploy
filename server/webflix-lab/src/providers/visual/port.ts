/**
 * Visual provider port (WFLX-W3) — the provider-neutral boundary between the
 * video compiler (src/video) and illustration backends.
 *
 * Ownership: Worker 3 (src/providers/visual), per the work order.
 *
 * Rules (binding, mirroring the W2 speech port):
 * - This port is provider-NEUTRAL. Provider-specific request/response
 *   structures live inside their adapter files, never here.
 * - Credentials are constructor/env-injected by TL-side runtime wiring.
 *   Adapters declare required keys via `requiredCredentialKeys()`; no
 *   credential-shaped strings may be committed in code, fixtures, logs or
 *   artifacts.
 * - All implementations must be deterministic when given a seed; the offline
 *   deterministic ink adapter is the canonical test path (no network, no keys).
 * - Output is an SVG *fragment* (content of an <svg> element, coordinate
 *   space 0..width / 0..height). The renderer embeds it; the compositor may
 *   transform it. Fragments carry NO text: exact labels render
 *   deterministically (StyleBible rule 1).
 */

/** Palette + canvas subset the provider needs (StyleBible projection). */
export interface IllustrationStyleProjection {
  readonly background: string;
  readonly backgroundDeep: string;
  readonly surface: string;
  readonly ink: string;
  readonly emphasis: string;
  readonly emphasisDeep: string;
  readonly emphasisSoft: string;
  readonly warning: string;
  readonly accentWarm: string;
  readonly accentGreen: string;
  readonly aiNode: string;
  readonly widthPx: number;
  readonly heightPx: number;
}

/** Neutral request for one scene's illustration layer. */
export interface IllustrationRequest {
  readonly sceneId: string;
  /** Provider-neutral editorial brief (VideoScene.visualBrief). */
  readonly brief: string;
  readonly style: IllustrationStyleProjection;
  readonly seed: string;
}

/** Neutral result for one scene's illustration layer. */
export interface IllustrationResult {
  readonly sceneId: string;
  /** SVG fragment (no <svg> root), coordinate space 0..width / 0..height. */
  readonly fragment: string;
  readonly widthPx: number;
  readonly heightPx: number;
  /** True when the fragment is byte-identical for identical requests. */
  readonly deterministic: boolean;
  /** Provider identity for provenance (provider-neutral string). */
  readonly providerId: string;
}

export interface IllustrationProviderCapabilities {
  /** Produces vector fragments (SVG) rather than raster bytes. */
  readonly vectorOutput: boolean;
  /** True when the provider needs network access. */
  readonly remote: boolean;
  /** Maximum fragments per request batch (1 = per-scene calls only). */
  readonly maxBatchSize: number;
}

export type IllustrationCredentialBag = Readonly<Record<string, string | undefined>>;

export interface IllustrationProviderOptions {
  readonly credentials?: IllustrationCredentialBag;
  readonly endpoint?: string;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  readonly seed?: string;
}

/** The IllustrationProvider port. */
export interface IllustrationProvider {
  readonly id: string;
  readonly kind: 'offline-deterministic' | 'remote-image-model';

  capabilities(): IllustrationProviderCapabilities;

  /** Env/config keys the adapter needs; empty for offline adapters. */
  requiredCredentialKeys(): readonly string[];

  /**
   * Produce the illustration fragment for one scene. Throws on credential
   * absence, transport failure or policy violation — never silently degrades.
   */
  illustrate(request: IllustrationRequest): Promise<IllustrationResult>;

  /** Optional liveness/credential probe for TL-side wiring checks. */
  healthCheck?(): Promise<{ ok: boolean; detail?: string }>;
}
