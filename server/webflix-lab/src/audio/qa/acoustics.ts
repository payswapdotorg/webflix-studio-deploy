/**
 * Audio pipeline (WFLX-P1, Deliverable B / EV-017) — acoustic measurement
 * primitives for the speech benchmark suite.
 *
 * Honest structural proxies ONLY (AGENTS.md binding rule: no LLM
 * self-assessment is evidence). Everything here is deterministic pure-TS
 * DSP over decoded PCM: band-energy profiles via the Goertzel algorithm at
 * log-spaced probe frequencies, RMS/peak levels, zero-crossing rate (pitch
 * proxy) and spectral centroid. The METHOD is recorded honestly with every
 * measurement: these are coarse instrumented proxies, not perceptual voice
 * identity verification — formant-band profile similarity is a necessary,
 * not sufficient, condition for same-voice identity.
 */

/** Formant-band proxy regions (declared; recorded with each measurement). */
export interface AcousticBand {
  readonly id: string;
  readonly minHz: number;
  readonly maxHz: number;
}

export const ACOUSTIC_BANDS: readonly AcousticBand[] = [
  { id: 'f0-region', minHz: 80, maxHz: 300 },
  { id: 'f1-region', minHz: 300, maxHz: 900 },
  { id: 'f2-region', minHz: 900, maxHz: 2500 },
  { id: 'f3-plus', minHz: 2500, maxHz: 8000 },
];

/** Probe frequencies: 12 per band, log-spaced (deterministic grid). */
export const PROBE_FREQUENCIES: readonly number[] = ACOUSTIC_BANDS.flatMap((band) => {
  const out: number[] = [];
  const count = 12;
  for (let i = 0; i < count; i += 1) {
    const t = i / (count - 1);
    out.push(band.minHz * Math.pow(band.maxHz / band.minHz, t));
  }
  return out;
});

/** Per-turn acoustic profile (the speaker-consistency proxy input). */
export interface TurnAcousticProfile {
  readonly turnId: string;
  readonly sampleRate: number;
  readonly durationSeconds: number;
  /** Mean frame RMS in dBFS over ACTIVE frames (silence-gated). */
  readonly activeRmsDb: number;
  readonly peakDb: number;
  /** Zero crossings per second over active frames (pitch proxy). */
  readonly zeroCrossingRateHz: number;
  /** Normalized band-energy vector (sums to 1, one entry per ACOUSTIC_BANDS). */
  readonly bandEnergy: readonly number[];
  /** Spectral centroid over the Goertzel power spectrum (Hz). */
  readonly spectralCentroidHz: number;
  /** Seconds of non-silent audio (frame RMS above -60 dBFS). */
  readonly activeSeconds: number;
}

/** Method description recorded alongside measurements (honest labeling). */
export const ACOUSTIC_METHOD =
  'Pure-TS deterministic DSP: long-term average spectrum (LTAS) — Hann-windowed Goertzel power at 48 log-spaced probes (80-8000 Hz, 12 per formant-band region) computed per 50 ms active frame (frame RMS > -60 dBFS) and energy-averaged across frames; band energies normalized to sum 1; ZCR and centroid over the same active frames. The Hann window is REQUIRED: with a rectangular window, tones at integer DFT bins of the frame length measure ~zero at every other integer bin (a flaw the benchmark test suite exposed). LTAS is the standard coarse voice-timbre estimator; it is a structural proxy, NOT perceptual voice-identity verification.';

const FRAME_MS = 50;
const SILENCE_DB = -60;

/** Hann-windowed Goertzel power at one frequency over a sample window.
 * The window is methodologically REQUIRED (see ACOUSTIC_METHOD). */
function goertzelPower(samples: Float64Array, start: number, length: number, sampleRate: number, freqHz: number): number {
  const k = Math.round((length * freqHz) / sampleRate);
  if (k === 0 || k > length / 2) return 0;
  const omega = (2 * Math.PI * k) / length;
  const coeff = 2 * Math.cos(omega);
  let sPrev = 0;
  let sPrev2 = 0;
  const end = Math.min(start + length, samples.length);
  const n = Math.max(1, end - start);
  for (let i = start; i < end; i += 1) {
    const window = 0.5 * (1 - Math.cos((2 * Math.PI * (i - start)) / (n - 1 || 1)));
    // Parentheses REQUIRED: `??` binds looser than `+`, so without them the
    // recurrence terms would attach to the nullish branch and silently drop
    // the filter state (a bug the benchmark's honest numbers exposed: two
    // voices with different fundamentals measured identical profiles).
    const s = ((samples[i] ?? 0) * window) + sPrev * coeff - sPrev2;
    sPrev2 = sPrev;
    sPrev = s;
  }
  const power = sPrev2 * sPrev2 + sPrev * sPrev - coeff * sPrev * sPrev2;
  return Math.max(0, power) / Math.max(1, end - start);
}

/** Frame boundaries over the whole turn. */
function framesOf(samples: Float64Array, sampleRate: number): { start: number; length: number }[] {
  const frameSamples = Math.max(1, Math.round((FRAME_MS / 1000) * sampleRate));
  const frames: { start: number; length: number }[] = [];
  for (let start = 0; start < samples.length; start += frameSamples) {
    frames.push({ start, length: Math.min(frameSamples, samples.length - start) });
  }
  return frames;
}

function frameRms(samples: Float64Array, frame: { start: number; length: number }): number {
  let sum = 0;
  const end = Math.min(frame.start + frame.length, samples.length);
  for (let i = frame.start; i < end; i += 1) {
    const value = samples[i] ?? 0;
    sum += value * value;
  }
  return Math.sqrt(sum / Math.max(1, end - frame.start));
}

function toDb(value: number): number {
  return 20 * Math.log10(Math.max(value, 1e-12));
}

/**
 * Compute the per-turn acoustic profile. Deterministic: identical samples ->
 * identical profile. Turns with (almost) no active audio produce a profile
 * with activeSeconds ~ 0 and NaN-free neutral band energies (uniform 1/n).
 */
export function turnAcousticProfile(
  turnId: string,
  samples: Float64Array,
  sampleRate: number,
): TurnAcousticProfile {
  const frames = framesOf(samples, sampleRate);
  const activeFrames = frames.filter((frame) => toDb(frameRms(samples, frame)) > SILENCE_DB);
  const activeSeconds = (activeFrames.length * FRAME_MS) / 1000;

  let peak = 0;
  for (let i = 0; i < samples.length; i += 1) {
    peak = Math.max(peak, Math.abs(samples[i] ?? 0));
  }

  // Active-frame RMS.
  let rmsSum = 0;
  for (const frame of activeFrames) rmsSum += frameRms(samples, frame) ** 2;
  const activeRms = activeFrames.length > 0 ? Math.sqrt(rmsSum / activeFrames.length) : 0;

  // ZCR over active frames.
  let crossings = 0;
  let zcSamples = 0;
  for (const frame of activeFrames) {
    const end = Math.min(frame.start + frame.length, samples.length);
    for (let i = frame.start + 1; i < end; i += 1) {
      if ((samples[i - 1] ?? 0) < 0 !== (samples[i] ?? 0) < 0) crossings += 1;
    }
    zcSamples += end - frame.start;
  }
  const durationSeconds = samples.length / sampleRate;
  const zeroCrossingRateHz = zcSamples > 0 ? (crossings / zcSamples) * sampleRate : 0;

  // LTAS (long-term average spectrum): Goertzel power per probe computed on
  // EVERY active frame and energy-averaged. Averaging across frames is what
  // makes this a voice-timbre estimator — single-frame spectra are dominated
  // by instantaneous content (vowels/consonants), not by the speaker.
  const powers: number[] = new Array<number>(PROBE_FREQUENCIES.length).fill(0);
  let frameCount = 0;
  for (const frame of activeFrames) {
    for (let p = 0; p < PROBE_FREQUENCIES.length; p += 1) {
      const freq = PROBE_FREQUENCIES[p] as number;
      powers[p] = (powers[p] ?? 0) + goertzelPower(samples, frame.start, frame.length, sampleRate, freq);
    }
    frameCount += 1;
  }
  const meanPowers =
    frameCount > 0 ? powers.map((value) => value / frameCount) : powers.map(() => 0);
  const bandEnergy: number[] = ACOUSTIC_BANDS.map((band) => {
    let sum = 0;
    PROBE_FREQUENCIES.forEach((freq, index) => {
      if (freq >= band.minHz && freq <= band.maxHz) sum += meanPowers[index] ?? 0;
    });
    return sum;
  });
  const totalEnergy = bandEnergy.reduce((a, b) => a + b, 0);
  const normalized =
    totalEnergy > 0 ? bandEnergy.map((value) => value / totalEnergy) : bandEnergy.map(() => 1 / bandEnergy.length);

  let centroidWeighted = 0;
  let powerSum = 0;
  PROBE_FREQUENCIES.forEach((freq, index) => {
    const power = meanPowers[index] ?? 0;
    centroidWeighted += freq * power;
    powerSum += power;
  });
  const spectralCentroidHz = powerSum > 0 ? centroidWeighted / powerSum : 0;

  return {
    turnId,
    sampleRate,
    durationSeconds,
    activeRmsDb: toDb(activeRms),
    peakDb: toDb(peak),
    zeroCrossingRateHz,
    bandEnergy: normalized,
    spectralCentroidHz,
    activeSeconds,
  };
}

/** L1 distance between two normalized band vectors (0..2). */
export function bandDistance(a: readonly number[], b: readonly number[]): number {
  let sum = 0;
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    sum += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
  }
  return sum;
}

/** Per-speaker aggregation for the consistency check. */
export interface SpeakerAcousticSummary {
  readonly speakerId: string;
  readonly turns: readonly string[];
  /** Mean band vector (centroid). */
  readonly centroid: readonly number[];
  /** Max L1 deviation of any turn from the speaker centroid. */
  readonly maxWithinDeviation: number;
  readonly meanZcrHz: number;
  readonly meanCentroidHz: number;
}

export interface SpeakerConsistencyMeasurement {
  readonly method: string;
  readonly speakers: readonly SpeakerAcousticSummary[];
  /** Max within-speaker deviation across ALL speakers. */
  readonly maxWithinSpeakerDeviation: number;
  /** Min pairwise L1 distance between distinct speakers' centroids. */
  readonly minBetweenSpeakerDistance: number;
  /** Separation ratio: min between distance / max within deviation. */
  readonly separationRatio: number;
  /** Declared tolerances (recorded with the measurement). */
  readonly tolerances: { readonly withinSpeakerMaxL1: number; readonly minSeparationRatio: number };
  readonly passed: boolean;
}

/**
 * Measure same-voice acoustic consistency across turns: within-speaker band
 * spread must sit under the declared tolerance AND between-speaker centroid
 * distance must exceed the within-speaker spread by the declared ratio.
 * Declared defaults (recorded honestly): within <= 0.20 L1; ratio >= 1.5.
 */
export function measureSpeakerAcousticConsistency(
  profiles: readonly TurnAcousticProfile[],
  speakerByTurn: ReadonlyMap<string, string>,
  tolerances: { withinSpeakerMaxL1: number; minSeparationRatio: number } = {
    withinSpeakerMaxL1: 0.2,
    minSeparationRatio: 1.5,
  },
): SpeakerConsistencyMeasurement {
  const bySpeaker = new Map<string, TurnAcousticProfile[]>();
  for (const profile of profiles) {
    const speaker = speakerByTurn.get(profile.turnId) ?? 'unknown';
    const list = bySpeaker.get(speaker) ?? [];
    list.push(profile);
    bySpeaker.set(speaker, list);
  }

  const summaries: SpeakerAcousticSummary[] = [];
  for (const [speakerId, turns] of bySpeaker) {
    const dims = ACOUSTIC_BANDS.length;
    const centroid = new Array<number>(dims).fill(0);
    for (const profile of turns) {
      profile.bandEnergy.forEach((value, i) => {
        centroid[i] = (centroid[i] ?? 0) + value / turns.length;
      });
    }
    let maxDeviation = 0;
    for (const profile of turns) {
      maxDeviation = Math.max(maxDeviation, bandDistance(profile.bandEnergy, centroid));
    }
    summaries.push({
      speakerId,
      turns: turns.map((t) => t.turnId),
      centroid,
      maxWithinDeviation: maxDeviation,
      meanZcrHz: turns.reduce((a, t) => a + t.zeroCrossingRateHz, 0) / turns.length,
      meanCentroidHz: turns.reduce((a, t) => a + t.spectralCentroidHz, 0) / turns.length,
    });
  }

  const maxWithinSpeakerDeviation = summaries.reduce((a, s) => Math.max(a, s.maxWithinDeviation), 0);
  let minBetweenSpeakerDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < summaries.length; i += 1) {
    for (let j = i + 1; j < summaries.length; j += 1) {
      minBetweenSpeakerDistance = Math.min(
        minBetweenSpeakerDistance,
        bandDistance(summaries[i]?.centroid ?? [], summaries[j]?.centroid ?? []),
      );
    }
  }
  if (!Number.isFinite(minBetweenSpeakerDistance)) minBetweenSpeakerDistance = 0;

  const separationRatio =
    maxWithinSpeakerDeviation > 0 ? minBetweenSpeakerDistance / maxWithinSpeakerDeviation : minBetweenSpeakerDistance > 0 ? Number.POSITIVE_INFINITY : 0;

  return {
    method: ACOUSTIC_METHOD,
    speakers: summaries,
    maxWithinSpeakerDeviation,
    minBetweenSpeakerDistance,
    separationRatio: Number.isFinite(separationRatio) ? separationRatio : 999,
    tolerances,
    passed:
      maxWithinSpeakerDeviation <= tolerances.withinSpeakerMaxL1 &&
      (summaries.length < 2 || separationRatio >= tolerances.minSeparationRatio),
  };
}
