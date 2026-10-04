/**
 * Offline deterministic video-generation adapter (WFLX-P2, Deliverable C1)
 * — the OFFLINE STAND-IN behind the VideoGenerativeProvider port.
 *
 * Deterministic placeholder for 'video-generation' jobs: an SVG poster
 * (subject-keyed, with motion metadata) behind the SAME job interface the
 * live adapter implements. Exercises job dispatch, validation gates,
 * fingerprinting, provenance and local regeneration with zero network.
 *
 * HONEST BOUNDARY (binding): the stand-in does NOT produce real video media
 * and is NOT product parity evidence. It reports format 'svg' (a poster, not
 * a clip), providerId 'offline-video-standin', deterministic: true; the
 * cinematic validation gates are stand-in-aware (format expectations keyed on
 * provider kind). Live execution is Deliverable C2 (EV-022).
 */

import { floatFor, intFor } from '../../video/rng';
import type {
  VideoGenerationRequest,
  VideoGenerationResult,
  VideoGenerativeCapabilities,
  VideoGenerativeOptions,
  VideoGenerativeProvider,
} from './generative-port';

export const OFFLINE_VIDEO_GENERATIVE_ID = 'offline-video-standin';
export const OFFLINE_VIDEO_GENERATIVE_MODEL = 'deterministic-placeholder-poster';

export class OfflineGenerativeVideo implements VideoGenerativeProvider {
  readonly id = OFFLINE_VIDEO_GENERATIVE_ID;
  readonly kind = 'offline-deterministic' as const;

  constructor(_options: VideoGenerativeOptions = {}) {
    void _options; // parity with the live adapter's signature
  }

  capabilities(): VideoGenerativeCapabilities {
    return { remote: false, realClips: false };
  }

  requiredCredentialKeys(): readonly string[] {
    return [];
  }

  async generateClip(request: VideoGenerationRequest): Promise<VideoGenerationResult> {
    const svg = this.placeholderPoster(request);
    const bytes = new TextEncoder().encode(svg);
    return {
      jobId: request.jobId,
      sceneId: request.sceneId,
      bytes,
      format: 'svg',
      widthPx: request.widthPx,
      heightPx: request.heightPx,
      providerId: this.id,
      modelId: OFFLINE_VIDEO_GENERATIVE_MODEL,
      deterministic: true,
      durationSeconds: request.durationSeconds,
    };
  }

  /** Deterministic poster + motion metadata (Cinematic shot-plan vector). */
  private placeholderPoster(request: VideoGenerationRequest): string {
    const { widthPx: w, heightPx: h } = request;
    const key = `${request.seed}|${request.subjectKey ?? 'scene'}`;
    const cx = floatFor(`${key}:cx`, 0.3, 0.7) * w;
    const cy = floatFor(`${key}:cy`, 0.35, 0.65) * h;
    const span = floatFor(`${key}:span`, 0.18, 0.3) * w;
    const steps = intFor(`${key}:steps`, 3, 5);
    const parts: string[] = [];
    parts.push(`<rect x="0" y="0" width="${w}" height="${h}" fill="#292a24"/>`);
    // Motion trajectory: ghosted subject positions across the planned span.
    for (let i = 0; i < steps; i += 1) {
      const t = i / Math.max(1, steps - 1);
      const x = cx - span / 2 + span * t;
      const r = 26 - i * 3;
      parts.push(
        `<circle cx="${x.toFixed(1)}" cy="${cy.toFixed(1)}" r="${Math.max(8, r)}" fill="#53dfcd" opacity="${(0.2 + t * 0.6).toFixed(2)}"/>`,
      );
    }
    // Camera-move guide (deterministic arrow of travel).
    parts.push(
      `<line x1="${(cx - span / 2 - 20).toFixed(1)}" y1="${(cy + 60).toFixed(1)}" x2="${(cx + span / 2 + 20).toFixed(1)}" y2="${(cy + 60).toFixed(1)}" stroke="#f2f4f5" stroke-width="3" stroke-dasharray="10,8" opacity="0.5"/>`,
      `<polygon points="${(cx + span / 2 + 20).toFixed(1)},${(cy + 60).toFixed(1)} ${(cx + span / 2 + 8).toFixed(1)},${(cy + 54).toFixed(1)} ${(cx + span / 2 + 8).toFixed(1)},${(cy + 66).toFixed(1)}" fill="#f2f4f5" opacity="0.5"/>`,
    );
    return parts.join('');
  }
}
