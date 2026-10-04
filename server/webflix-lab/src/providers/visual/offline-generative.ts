/**
 * Offline deterministic generative-visual adapter (WFLX-P2, Deliverable C1)
 * — the OFFLINE STAND-IN behind the VisualGenerativeProvider port.
 *
 * A deterministic placeholder renderer: identical requests produce
 * byte-identical asset bytes (pure function of the request — palette,
 * subject key, seed, class and canvas). It exercises the FULL cinematic job
 * interface (job dispatch, validation gates, fingerprinting, provenance,
 * local regeneration) with ZERO network and zero credentials.
 *
 * HONEST BOUNDARY (binding): stand-in output is a lab placeholder, NOT a
 * real generative result and NOT product parity evidence. The adapter
 * reports providerId 'offline-generative-standin' and deterministic: true so
 * every downstream record, artifact and QA flag can label it honestly; live
 * execution is Deliverable C2 (EV-022).
 */

import { fnv1a32, floatFor, intFor } from '../../video/rng';
import type {
  VisualGenerativeCapabilities,
  VisualGenerativeOptions,
  VisualGenerativeProvider,
  VisualAssetRequest,
  VisualAssetResult,
} from './generative-port';

export const OFFLINE_VISUAL_GENERATIVE_ID = 'offline-generative-standin';
export const OFFLINE_VISUAL_GENERATIVE_MODEL = 'deterministic-placeholder-renderer';

/** Deterministic placeholder renderer (WFLX-P2 cinematic offline arm). */
export class OfflineGenerativeVisual implements VisualGenerativeProvider {
  readonly id = OFFLINE_VISUAL_GENERATIVE_ID;
  readonly kind = 'offline-deterministic' as const;

  constructor(_options: VisualGenerativeOptions = {}) {
    void _options; // parity with the live adapter's signature
  }

  capabilities(): VisualGenerativeCapabilities {
    return { remote: false, rasterOutput: false };
  }

  requiredCredentialKeys(): readonly string[] {
    return [];
  }

  async generateAsset(request: VisualAssetRequest): Promise<VisualAssetResult> {
    const svg = this.placeholderFragment(request);
    const bytes = new TextEncoder().encode(svg);
    return {
      jobId: request.jobId,
      sceneId: request.sceneId,
      bytes,
      format: 'svg',
      widthPx: request.widthPx,
      heightPx: request.heightPx,
      providerId: this.id,
      modelId: OFFLINE_VISUAL_GENERATIVE_MODEL,
      deterministic: true,
    };
  }

  /**
   * The placeholder fragment: a subject-keyed geometric composition in the
   * active palette, visibly class-differentiated (still vs animated key
   * art), deterministic in every byte. No text (labels stay deterministic
   * per StyleBible rule 1).
   */
  private placeholderFragment(request: VisualAssetRequest): string {
    const { palette, widthPx: w, heightPx: h } = request;
    const key = `${request.seed}|${request.subjectKey ?? 'scene'}|${request.assetClass}`;
    const x = floatFor(`${key}:x`, 0.3, 0.7) * w;
    const y = floatFor(`${key}:y`, 0.35, 0.65) * h;
    const r = floatFor(`${key}:r`, 0.12, 0.2) * Math.min(w, h);
    const dx = floatFor(`${key}:dx`, -0.08, 0.08) * w;
    const dy = floatFor(`${key}:dy`, -0.06, 0.06) * h;
    const satellites = intFor(`${key}:sats`, 3, 6);

    const parts: string[] = [];
    // Ground field (background with a deterministic vignette band).
    parts.push(`<rect x="0" y="0" width="${w}" height="${h}" fill="${palette.background}"/>`);
    parts.push(
      `<rect x="0" y="${Math.round(h * 0.72)}" width="${w}" height="${Math.round(h * 0.28)}" fill="${palette.background}" opacity="0.6"/>`,
    );
    // Subject mark: nested rings keyed by the subject hash.
    parts.push(
      `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" fill="none" stroke="${palette.emphasis}" stroke-width="3"/>`,
      `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(r * 0.62).toFixed(1)}" fill="${palette.emphasis}" opacity="0.32"/>`,
      `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(r * 0.28).toFixed(1)}" fill="${palette.ink}" opacity="0.85"/>`,
    );
    // Satellites (orbit marks) — count/positions keyed by seed+subject.
    for (let i = 0; i < satellites; i += 1) {
      const angle = (floatFor(`${key}:sat-${i}:a`, 0, Math.PI * 2) * 180) / Math.PI;
      const dist = r * (1.25 + floatFor(`${key}:sat-${i}:d`, 0, 0.45));
      const sx = x + dist * Math.cos((angle * Math.PI) / 180);
      const sy = y + dist * Math.sin((angle * Math.PI) / 180);
      const sr = r * floatFor(`${key}:sat-${i}:r`, 0.08, 0.2);
      parts.push(
        `<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="${sr.toFixed(1)}" fill="${palette.warning}" opacity="${floatFor(`${key}:sat-${i}:o`, 0.5, 0.9).toFixed(2)}"/>`,
      );
    }
    // Animated class: motion trajectory guide (deterministic).
    if (request.assetClass === 'generative-animation') {
      parts.push(
        `<path d="M ${(x - dx).toFixed(1)} ${(y - dy).toFixed(1)} Q ${x.toFixed(1)} ${(y - dy * 2).toFixed(1)} ${(x + dx).toFixed(1)} ${(y + dy).toFixed(1)}" fill="none" stroke="${palette.ink}" stroke-width="2" stroke-dasharray="6,8" opacity="0.6"/>`,
      );
    }
    // Provenance mark (visible, non-textual): a subject-keyed corner tick grid.
    for (let i = 0; i < 4; i += 1) {
      const tx = 24 + i * 12;
      const th = 6 + ((fnv1a32(`${key}:tick-${i}`) % 5) + 1);
      parts.push(`<rect x="${tx}" y="${h - 24 - th}" width="3" height="${th}" fill="${palette.emphasis}" opacity="0.7"/>`);
    }
    return parts.join('');
  }
}
