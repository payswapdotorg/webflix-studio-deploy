/**
 * Audio pipeline (WFLX-W2, Stage 2) — loudness measurement and mastering.
 *
 * Pure-TS integrated loudness per ITU-R BS.1770-4 (K-weighting + 400 ms
 * blocks at 75% overlap + absolute/relative gating), measured at 48 kHz using
 * the coefficients published in the standard; the 44.1 kHz master is linearly
 * resampled for measurement (documented approximation). True peak is
 * approximated by sample peak (documented limitation).
 *
 * Mastering target (DESIGN.md §8): −16 LUFS integrated, −1.5 dBTP ceiling —
 * podcast-typical defaults, UNRESOLVED vs the real product. Gain is applied
 * deterministically; when the target gain would clip, gain is limited and the
 * limitation is reported (QA `loudness-limited`).
 */

import type { QaIssue } from '../../contracts';
import type { SampleSource } from './wav';

export const MASTER_SAMPLE_RATE = 44100;
export const TARGET_LUFS = -16;
/** −1.5 dBTP ceiling as a linear amplitude bound (sample-peak approximation). */
export const PEAK_CEILING = 10 ** (-1.5 / 20);

/** BS.1770-4 K-weighting biquads at 48 kHz (coefficients from the standard). */
const K_STAGE_1_B = [1.53512485958697, -2.69169618940638, 1.19839281085285] as const;
const K_STAGE_1_A = [1.0, -1.69065929318241, 0.73248077421585] as const;
const K_STAGE_2_B = [1.0, -2.0, 1.0] as const;
const K_STAGE_2_A = [1.0, -1.99004745483398, 0.99007225036621] as const;

/** Measurement sample rate per the standard's published coefficients. */
const MEASUREMENT_RATE = 48000;
/** Block size 400 ms, hop 100 ms (75% overlap) at 48 kHz. */
const BLOCK_SAMPLES = Math.round(0.4 * MEASUREMENT_RATE);
const HOP_SAMPLES = Math.round(0.1 * MEASUREMENT_RATE);

interface Biquad {
  readonly b: readonly number[];
  readonly a: readonly number[];
  x1: number;
  x2: number;
  y1: number;
  y2: number;
}

function biquad(coeffs: { b: readonly number[]; a: readonly number[] }): Biquad {
  return { b: coeffs.b, a: coeffs.a, x1: 0, x2: 0, y1: 0, y2: 0 };
}

function processBiquad(filter: Biquad, x: number): number {
  const [b0, b1, b2] = filter.b as [number, number, number];
  const [a0, a1, a2] = filter.a as [number, number, number];
  const y = (b0 * x + b1 * filter.x1 + b2 * filter.x2 - a1 * filter.y1 - a2 * filter.y2) / a0;
  filter.x2 = filter.x1;
  filter.x1 = x;
  filter.y2 = filter.y1;
  filter.y1 = y;
  return y;
}

/**
 * Integrated loudness (LUFS) of a mono float signal. Returns -Infinity for
 * digital silence (QA treats it as unmeasurable).
 */
export function measureIntegratedLufs(samples: SampleSource, sampleRate: number): number {
  const measurement = resampleForMeasurement(samples, sampleRate);
  if (measurement.length < BLOCK_SAMPLES) {
    return -Infinity;
  }
  const stage1 = biquad({ b: K_STAGE_1_B, a: K_STAGE_1_A });
  const stage2 = biquad({ b: K_STAGE_2_B, a: K_STAGE_2_A });
  const weighted = new Float64Array(measurement.length);
  for (let i = 0; i < measurement.length; i += 1) {
    const x = measurement[i] ?? 0;
    weighted[i] = processBiquad(stage2, processBiquad(stage1, x));
  }

  // Block mean squares with absolute gating at -70 LUFS.
  const blockPowers: number[] = [];
  for (let start = 0; start + BLOCK_SAMPLES <= weighted.length; start += HOP_SAMPLES) {
    let acc = 0;
    for (let i = start; i < start + BLOCK_SAMPLES; i += 1) {
      const z = weighted[i] ?? 0;
      acc += z * z;
    }
    blockPowers.push(acc / BLOCK_SAMPLES);
  }
  const toLoudness = (power: number): number => -0.691 + 10 * Math.log10(power);
  const aboveThreshold = blockPowers.filter((p) => toLoudness(p) > -70);
  if (aboveThreshold.length === 0) {
    return -Infinity;
  }
  // Relative gating: keep blocks within 10 LU below the ungated mean.
  const ungatedMean = aboveThreshold.reduce((acc, p) => acc + p, 0) / aboveThreshold.length;
  const gate = toLoudness(ungatedMean) - 10;
  const gated = aboveThreshold.filter((p) => toLoudness(p) > gate);
  const pool = gated.length > 0 ? gated : aboveThreshold;
  const mean = pool.reduce((acc, p) => acc + p, 0) / pool.length;
  return toLoudness(mean);
}

/** Sample peak as dBFS (0 dBFS == 1.0). */
export function samplePeakDb(samples: SampleSource): number {
  let peak = 0;
  for (let i = 0; i < samples.length; i += 1) {
    peak = Math.max(peak, Math.abs(samples[i] ?? 0));
  }
  return peak === 0 ? -Infinity : 20 * Math.log10(peak);
}

export interface MasterResult {
  readonly samples: Float64Array;
  readonly sampleRate: number;
  readonly measuredLufs: number;
  readonly appliedGainDb: number;
  readonly limitingApplied: boolean;
  readonly finalLufs: number;
  readonly finalPeakDb: number;
  readonly issues: readonly QaIssue[];
}

/**
 * Pure-TS mastering: normalize to the loudness target with the peak ceiling.
 * Deterministic given identical input samples.
 */
export function masterSamples(
  samples: SampleSource,
  sampleRate: number,
  targetLufs = TARGET_LUFS,
): MasterResult {
  const issues: QaIssue[] = [];
  const measuredLufs = measureIntegratedLufs(samples, sampleRate);
  let appliedGainDb = 0;
  let limitingApplied = false;

  if (Number.isFinite(measuredLufs)) {
    appliedGainDb = targetLufs - measuredLufs;
    // Clip guard: if the linear gain would exceed the ceiling, limit it.
    let peak = 0;
    for (let i = 0; i < samples.length; i += 1) {
      peak = Math.max(peak, Math.abs(samples[i] ?? 0));
    }
    if (peak > 0) {
      const maxGainDb = 20 * Math.log10(PEAK_CEILING / peak);
      if (appliedGainDb > maxGainDb) {
        appliedGainDb = maxGainDb;
        limitingApplied = true;
        issues.push({
          severity: 'warning',
          code: 'loudness-limited',
          message: `target gain limited by the -1.5 dB peak ceiling (applied ${appliedGainDb.toFixed(2)} dB)`,
        });
      }
    }
  }

  const gain = 10 ** (appliedGainDb / 20);
  const out = new Float64Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    out[i] = (samples[i] ?? 0) * gain;
  }

  // A pure linear gain (clip-guarded above) shifts integrated loudness by
  // exactly the applied dB — no second measurement pass needed. Unmeasurable
  // input stays unmeasurable.
  const finalLufs = Number.isFinite(measuredLufs) ? measuredLufs + appliedGainDb : -Infinity;
  const finalPeakDb = samplePeakDb(out);
  if (
    Number.isFinite(finalLufs) &&
    Math.abs(finalLufs - targetLufs) > 1.0 &&
    !limitingApplied
  ) {
    issues.push({
      severity: 'warning',
      code: 'loudness-off-target',
      message: `final integrated loudness ${finalLufs.toFixed(2)} LUFS vs target ${targetLufs} LUFS`,
    });
  }

  return {
    samples: out,
    sampleRate,
    measuredLufs,
    appliedGainDb,
    limitingApplied,
    finalLufs,
    finalPeakDb,
    issues,
  };
}

function resampleForMeasurement(samples: SampleSource, sampleRate: number): Float64Array {
  if (sampleRate === MEASUREMENT_RATE) {
    return Float64Array.from(samples);
  }
  const ratio = MEASUREMENT_RATE / sampleRate;
  const outLength = Math.max(1, Math.round(samples.length * ratio));
  const out = new Float64Array(outLength);
  for (let i = 0; i < outLength; i += 1) {
    const srcPos = i / ratio;
    const i0 = Math.floor(srcPos);
    const i1 = Math.min(samples.length - 1, i0 + 1);
    const frac = srcPos - i0;
    const s0 = samples[i0] ?? 0;
    const s1 = samples[i1] ?? s0;
    out[i] = s0 + (s1 - s0) * frac;
  }
  return out;
}
