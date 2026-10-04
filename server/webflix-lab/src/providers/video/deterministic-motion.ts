/**
 * Deterministic motion adapter (WFLX-W3) — the offline canonical motion
 * provider. Plans camera moves as pure functions of (motion intent, seed,
 * canvas, duration); no media bytes, no network, no keys.
 *
 * Motion vocabulary follows the annotation grammar:
 * - static: identity (no motion spent — the default, 37/49 reference segments);
 * - pan: slow lateral drift (≤ ~4% of canvas over the scene);
 * - zoom: gentle push-in toward the center-weighted subject (≤ ~8% scale);
 * - parallax: opposing drifts of ground vs subject layers;
 * - animated-diagram: slow push-in + hold (diagram reveal emphasis).
 */

import { floatFor } from '../../video/rng';
import type {
  MotionPlan,
  MotionPlanRequest,
  MotionProvider,
  MotionProviderCapabilities,
  MotionProviderOptions,
} from './port';

const MOTION_PROVIDER_ID = 'deterministic-motion';

export class DeterministicMotionProvider implements MotionProvider {
  readonly id = MOTION_PROVIDER_ID;
  readonly kind = 'offline-deterministic' as const;

  constructor(_options: MotionProviderOptions = {}) {
    // Options accepted for interface parity; this adapter needs nothing.
    void _options;
  }

  capabilities(): MotionProviderCapabilities {
    return { parametricMotion: true, generatedClips: false, remote: false };
  }

  requiredCredentialKeys(): readonly string[] {
    return [];
  }

  async planMotion(request: MotionPlanRequest): Promise<MotionPlan> {
    const { seed, motion } = request;
    const w = request.canvasWidthPx;
    const h = request.canvasHeightPx;

    // Slightly randomized direction/extent per scene (seeded, bounded small:
    // the reference's motion is deliberate and gentle).
    const panX = floatFor(`${seed}:pan-x`, -0.04, 0.04) * w;
    const panY = floatFor(`${seed}:pan-y`, -0.03, 0.03) * h;
    const zoom = 1 + floatFor(`${seed}:zoom`, 0.03, 0.08);

    switch (motion) {
      case 'pan':
        return {
          sceneId: request.sceneId,
          motion,
          from: { dx: -panX / 2, dy: -panY / 2, scale: 1.02 },
          to: { dx: panX / 2, dy: panY / 2, scale: 1.02 },
          easing: 'ease-in-out',
          providerId: MOTION_PROVIDER_ID,
          deterministic: true,
        };
      case 'zoom':
        return {
          sceneId: request.sceneId,
          motion,
          from: { dx: 0, dy: 0, scale: 1 },
          to: { dx: 0, dy: 0, scale: zoom },
          easing: 'ease-in-out',
          providerId: MOTION_PROVIDER_ID,
          deterministic: true,
        };
      case 'parallax':
        return {
          sceneId: request.sceneId,
          motion,
          from: { dx: -panX, dy: 0, scale: 1.03 },
          to: { dx: panX, dy: 0, scale: 1.03 },
          easing: 'ease-in-out',
          providerId: MOTION_PROVIDER_ID,
          deterministic: true,
        };
      case 'animated-diagram':
        return {
          sceneId: request.sceneId,
          motion,
          from: { dx: 0, dy: 0, scale: 1 },
          to: { dx: 0, dy: 0, scale: 1 + (zoom - 1) * 0.6 },
          easing: 'ease-in-out',
          providerId: MOTION_PROVIDER_ID,
          deterministic: true,
        };
      case 'static':
      default:
        return {
          sceneId: request.sceneId,
          motion: 'static',
          from: { dx: 0, dy: 0, scale: 1 },
          to: { dx: 0, dy: 0, scale: 1 },
          easing: 'linear',
          providerId: MOTION_PROVIDER_ID,
          deterministic: true,
        };
    }
  }
}
