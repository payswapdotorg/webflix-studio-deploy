/**
 * Deterministic ink illustration adapter (WFLX-W3) — the offline canonical
 * illustration provider.
 *
 * Produces hand-drawn-feel technical SVG fragments in the Reference Ink
 * grammar WITHOUT any network or keys: graphite ground with paper grain,
 * sketch construction lines, hexagonal nodes, glowing cyan conduits, dashed
 * circular pathways and isometric hardware hints (the annotation's recurring
 * motifs). All choices derive from the seeded PRNG keyed by the request
 * seed — identical requests produce byte-identical fragments.
 *
 * This is a lab reconstruction instrument, NOT product parity evidence: the
 * reference's illustrations are model-generated; this adapter stands in
 * deterministically so the full pipeline is reproducible offline
 * (same position as W2's DeterministicOfflineTtsAdapter).
 */

import { fnv1a32, floatFor, intFor, mulberry32 } from '../../video/rng';
import type {
  IllustrationProvider,
  IllustrationProviderCapabilities,
  IllustrationProviderOptions,
  IllustrationRequest,
  IllustrationResult,
} from './port';

const INK_PROVIDER_ID = 'deterministic-ink';

interface StrokeSpec {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly stroke: string;
  readonly width: number;
  readonly opacity: number;
}

/**
 * Deterministic "hand-drawn" polyline: segments with seeded perpendicular
 * jitter, stable across runs. Pure function of (points, seedKey, amp).
 */
function inkPolyline(
  points: readonly { x: number; y: number }[],
  seedKey: string,
  amp: number,
): string {
  if (points.length === 0) {
    return '';
  }
  const rand = mulberry32(fnv1a32(seedKey));
  const cmds: string[] = [];
  points.forEach((point, i) => {
    if (i === 0) {
      cmds.push(`M ${rnd(point.x + (rand() - 0.5) * amp)} ${rnd(point.y + (rand() - 0.5) * amp)}`);
      return;
    }
    const prev = points[i - 1];
    if (prev === undefined) {
      return;
    }
    const steps = Math.max(1, Math.round(Math.hypot(point.x - prev.x, point.y - prev.y) / 46));
    for (let s = 1; s <= steps; s += 1) {
      const t = s / steps;
      const x = prev.x + (point.x - prev.x) * t + (rand() - 0.5) * amp;
      const y = prev.y + (point.y - prev.y) * t + (rand() - 0.5) * amp;
      cmds.push(`L ${rnd(x)} ${rnd(y)}`);
    }
  });
  return cmds.join(' ');
}

function rnd(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2).replace(/\.?0+$/, '') || '0';
}

function hexPoints(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i += 1) {
    const angle = (Math.PI / 3) * i - Math.PI / 6;
    pts.push(`${rnd(cx + r * Math.cos(angle))},${rnd(cy + r * Math.sin(angle))}`);
  }
  return pts.join(' ');
}

export class DeterministicInkIllustration implements IllustrationProvider {
  readonly id = INK_PROVIDER_ID;
  readonly kind = 'offline-deterministic' as const;

  private readonly baseSeed: string | undefined;

  constructor(options: IllustrationProviderOptions = {}) {
    this.baseSeed = options.seed;
  }

  capabilities(): IllustrationProviderCapabilities {
    return { vectorOutput: true, remote: false, maxBatchSize: 1 };
  }

  requiredCredentialKeys(): readonly string[] {
    return [];
  }

  async illustrate(request: IllustrationRequest): Promise<IllustrationResult> {
    const seed = this.baseSeed !== undefined ? `${this.baseSeed}:${request.seed}` : request.seed;
    const fragment = this.composeFragment(request, seed);
    return {
      sceneId: request.sceneId,
      fragment,
      widthPx: request.style.widthPx,
      heightPx: request.style.heightPx,
      deterministic: true,
      providerId: INK_PROVIDER_ID,
    };
  }

  private composeFragment(request: IllustrationRequest, seed: string): string {
    const { style } = request;
    const w = style.widthPx;
    const h = style.heightPx;
    const parts: string[] = [];

    // 1. Paper grain: sparse seeded specks (two tones, low opacity).
    const specks = intFor(`${seed}:specks`, 90, 140);
    for (let i = 0; i < specks; i += 1) {
      const x = floatFor(`${seed}:speck-x:${i}`, 0, w);
      const y = floatFor(`${seed}:speck-y:${i}`, 0, h);
      const r = floatFor(`${seed}:speck-r:${i}`, 0.6, 1.8);
      const tone = i % 3 === 0 ? style.backgroundDeep : style.surface;
      parts.push(
        `<circle cx="${rnd(x)}" cy="${rnd(y)}" r="${rnd(r)}" fill="${tone}" opacity="${rnd(floatFor(`${seed}:speck-o:${i}`, 0.05, 0.16))}"/>`,
      );
    }

    // 2. Construction grid: faint sketch lines (annotation: "sketch-in-progress" aesthetic).
    const gridStep = intFor(`${seed}:grid`, 110, 150);
    for (let gx = gridStep; gx < w; gx += gridStep) {
      parts.push(
        `<path d="${inkPolyline([{ x: gx, y: 40 }, { x: gx, y: h - 40 }], `${seed}:gx:${gx}`, 3)}" fill="none" stroke="${style.surface}" stroke-width="1" opacity="0.14"/>`,
      );
    }
    for (let gy = gridStep; gy < h; gy += gridStep) {
      parts.push(
        `<path d="${inkPolyline([{ x: 40, y: gy }, { x: w - 40, y: gy }], `${seed}:gy:${gy}`, 3)}" fill="none" stroke="${style.surface}" stroke-width="1" opacity="0.14"/>`,
      );
    }

    // 3. Central motif: controller mark (hexagon cluster) with glow.
    const cx = w / 2 + floatFor(`${seed}:cx`, -60, 60);
    const cy = h / 2 + floatFor(`${seed}:cy`, -40, 40);
    const coreR = floatFor(`${seed}:core`, 92, 132);
    parts.push(
      `<circle cx="${rnd(cx)}" cy="${rnd(cy)}" r="${rnd(coreR * 1.75)}" fill="none" stroke="${style.emphasisSoft}" stroke-width="1" opacity="0.35"/>`,
    );
    parts.push(
      `<polygon points="${hexPoints(cx, cy, coreR)}" fill="${style.backgroundDeep}" stroke="${style.emphasis}" stroke-width="${rnd(3)}" opacity="0.95"/>`,
    );
    parts.push(
      `<polygon points="${hexPoints(cx, cy, coreR * 0.55)}" fill="none" stroke="${style.emphasisDeep}" stroke-width="1.5" opacity="0.8"/>`,
    );
    // Knot hint: inner triangle pair.
    const tri = (phase: number): string => {
      const pts: string[] = [];
      for (let i = 0; i < 3; i += 1) {
        const angle = (2 * Math.PI * (i + phase)) / 3 - Math.PI / 2;
        pts.push(`${rnd(cx + coreR * 0.4 * Math.cos(angle))},${rnd(cy + coreR * 0.4 * Math.sin(angle))}`);
      }
      return pts.join(' ');
    };
    parts.push(`<polygon points="${tri(0)}" fill="none" stroke="${style.emphasis}" stroke-width="1.5" opacity="0.7"/>`);
    parts.push(`<polygon points="${tri(0.5)}" fill="none" stroke="${style.emphasisDeep}" stroke-width="1.5" opacity="0.7"/>`);

    // 4. Satellite hex nodes + glowing conduits (motif: hexagonal nodes).
    const sats = intFor(`${seed}:sats`, 3, 5);
    for (let i = 0; i < sats; i += 1) {
      const angle = floatFor(`${seed}:sat-a:${i}`, 0, Math.PI * 2);
      const dist = floatFor(`${seed}:sat-d:${i}`, coreR * 1.9, coreR * 2.6);
      const sx = cx + dist * Math.cos(angle);
      const sy = cy + dist * Math.sin(angle);
      const sr = floatFor(`${seed}:sat-r:${i}`, 30, 52);
      const conduit = inkPolyline(
        [
          { x: cx + coreR * Math.cos(angle), y: cy + coreR * Math.sin(angle) },
          { x: sx - sr * Math.cos(angle), y: sy - sr * Math.sin(angle) },
        ],
        `${seed}:conduit:${i}`,
        5,
      );
      parts.push(
        `<path d="${conduit}" fill="none" stroke="${style.emphasis}" stroke-width="2" opacity="0.75"/>`,
      );
      parts.push(
        `<polygon points="${hexPoints(sx, sy, sr)}" fill="${style.backgroundDeep}" stroke="${i % 2 === 0 ? style.emphasis : style.aiNode}" stroke-width="2" opacity="0.9"/>`,
      );
    }

    // 5. Dashed circular pathway (motif: dashed loops).
    const loopR = floatFor(`${seed}:loop`, coreR * 2.6, coreR * 3.2);
    parts.push(
      `<circle cx="${rnd(cx)}" cy="${rnd(cy)}" r="${rnd(loopR)}" fill="none" stroke="${style.emphasisDeep}" stroke-width="2" stroke-dasharray="12 10" opacity="0.4"/>`,
    );

    // 6. Isometric hardware hints (motif): two stacked slabs bottom-left.
    const slabW = floatFor(`${seed}:slab`, 150, 210);
    const slabH = slabW * 0.42;
    const bx = floatFor(`${seed}:slab-x`, 90, 150);
    const by = h - floatFor(`${seed}:slab-y`, 120, 170);
    for (let i = 0; i < 2; i += 1) {
      const dx = i * 26;
      const dy = -i * 30;
      parts.push(
        `<path d="${inkPolyline(
          [
            { x: bx + dx, y: by + dy },
            { x: bx + dx + slabW / 2, y: by + dy - slabH / 2 },
            { x: bx + dx + slabW, y: by + dy },
            { x: bx + dx + slabW / 2, y: by + dy + slabH / 2 },
            { x: bx + dx, y: by + dy },
          ],
          `${seed}:slab:${i}`,
          4,
        )}" fill="${style.backgroundDeep}" stroke="${style.emphasisSoft}" stroke-width="2" opacity="0.8"/>`,
      );
    }

    // 7. Warm energy accent: small arc near the core.
    const arcA = floatFor(`${seed}:arc`, 0, Math.PI * 2);
    const arcR = coreR * 1.35;
    const ax = cx + arcR * Math.cos(arcA);
    const ay = cy + arcR * Math.sin(arcA);
    parts.push(
      `<circle cx="${rnd(ax)}" cy="${rnd(ay)}" r="7" fill="${style.accentWarm}" opacity="0.85"/>`,
    );

    // 8. Corner tick marks (drafting feel).
    const ticks: StrokeSpec[] = [
      { x1: 48, y1: 48, x2: 84, y2: 48, stroke: style.emphasisSoft, width: 2, opacity: 0.7 },
      { x1: 48, y1: 48, x2: 48, y2: 84, stroke: style.emphasisSoft, width: 2, opacity: 0.7 },
      { x1: w - 48, y1: h - 48, x2: w - 84, y2: h - 48, stroke: style.emphasisSoft, width: 2, opacity: 0.7 },
      { x1: w - 48, y1: h - 48, x2: w - 48, y2: h - 84, stroke: style.emphasisSoft, width: 2, opacity: 0.7 },
    ];
    for (const tick of ticks) {
      parts.push(
        `<line x1="${rnd(tick.x1)}" y1="${rnd(tick.y1)}" x2="${rnd(tick.x2)}" y2="${rnd(tick.y2)}" stroke="${tick.stroke}" stroke-width="${tick.width}" opacity="${tick.opacity}"/>`,
      );
    }

    return parts.join('');
  }
}
