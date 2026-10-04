/**
 * Audio pipeline (WFLX-W2, Stage 2) — mixing and track mastering.
 *
 * Mix (always pure-TS): decode each provider payload to mono PCM, normalize
 * to the common format (44.1 kHz), and concatenate per the (re-timed)
 * TimingManifest including policy gap silence (DESIGN.md §8 steps 1–2).
 *
 * Master (two backends, deterministic given identical inputs):
 *   - 'pure-ts': BS.1770-4 loudness gain to −16 LUFS with a −1.5 dB peak
 *     ceiling, then WAV encode. Byte-identical across environments.
 *   - 'ffmpeg': loudnorm filter + pcm_s16le WAV (plus optional MP3) through
 *     the ffmpeg binary when available on PATH. Deterministic per ffmpeg
 *     version; the version is recorded in provenance.
 *
 * Backend 'auto' prefers ffmpeg when present (task packet §2 item 4); the
 * committed benchmark pins 'pure-ts' so its sidecars regenerate byte-identically
 * anywhere (the golden-media precedent: fingerprints committed, bytes
 * reproducible).
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Id, QaIssue } from '../../contracts';
import type { AudioPayload } from '../../providers/audio/port';
import { decodeWav, encodeWavPcm16, pcm16ToFloats, resampleLinear } from './wav';
import { measureIntegratedLufs, masterSamples, samplePeakDb, MASTER_SAMPLE_RATE, TARGET_LUFS } from './master';
import { ffmpegAvailable, ffmpegVersion, runFfmpeg } from './ffmpeg';
import type { TimingManifest } from '../timing/manifest';

// ---------------------------------------------------------------------------
// Mixing
// ---------------------------------------------------------------------------

export interface TurnAudio {
  readonly turnId: Id;
  readonly audio: AudioPayload;
}

export interface MixResult {
  /** Unmastered concatenated mix (turns + gap silence), 44.1 kHz mono. */
  readonly samples: Float64Array;
  readonly sampleRate: number;
  /** Measured (actual) duration per turn, seconds — provider samples are truth. */
  readonly actualSecondsByTurnId: ReadonlyMap<Id, number>;
  /** Total mix duration in seconds. */
  readonly durationSeconds: number;
}

/** Decode a provider payload to mono floats at its native sample rate. */
function payloadToMono(payload: AudioPayload): { samples: Float64Array; sampleRate: number } {
  if (payload.container === 'wav') {
    const decoded = decodeWav(payload.data);
    return { samples: decoded.samples, sampleRate: decoded.sampleRate };
  }
  if (payload.container === 'pcm-raw') {
    return { samples: pcm16ToFloats(payload.data), sampleRate: payload.sampleRate };
  }
  throw new Error(`mix: unsupported audio container '${payload.container}'`);
}

/** Concatenate turn audio + gap silence per the manifest. */
export function mixTurns(
  turnAudio: readonly TurnAudio[],
  manifest: TimingManifest,
): MixResult {
  const byId = new Map(turnAudio.map((entry) => [entry.turnId, entry]));
  const chunks: Float64Array[] = [];
  const actualSeconds = new Map<Id, number>();
  let totalSamples = 0;

  for (const entry of manifest.entries) {
    const payload = byId.get(entry.turnId);
    if (payload === undefined) {
      throw new Error(`mix: missing audio for turn ${entry.turnId}`);
    }
    const { samples, sampleRate } = payloadToMono(payload.audio);
    const normalized =
      sampleRate === MASTER_SAMPLE_RATE ? samples : resampleLinear(samples, sampleRate, MASTER_SAMPLE_RATE);
    chunks.push(normalized);
    totalSamples += normalized.length;
    actualSeconds.set(entry.turnId, normalized.length / MASTER_SAMPLE_RATE);

    if (entry.gapAfterMs > 0) {
      const gapSamples = Math.round((entry.gapAfterMs / 1000) * MASTER_SAMPLE_RATE);
      chunks.push(new Float64Array(gapSamples));
      totalSamples += gapSamples;
    }
  }

  const samples = new Float64Array(totalSamples);
  let offset = 0;
  for (const chunk of chunks) {
    samples.set(chunk, offset);
    offset += chunk.length;
  }
  return {
    samples,
    sampleRate: MASTER_SAMPLE_RATE,
    actualSecondsByTurnId: actualSeconds,
    durationSeconds: totalSamples / MASTER_SAMPLE_RATE,
  };
}

// ---------------------------------------------------------------------------
// Mastering
// ---------------------------------------------------------------------------

export type MasteringBackend = 'auto' | 'ffmpeg' | 'pure-ts';

export interface MasterOptions {
  readonly backend?: MasteringBackend;
  /** Additionally emit an MP3 (ffmpeg path only; ignored otherwise). */
  readonly mp3?: boolean;
  readonly targetLufs?: number;
}

export interface MasterResultOutput {
  readonly backend: 'pure-ts' | 'ffmpeg';
  readonly backendDetail: string;
  readonly wav: Uint8Array;
  readonly mp3?: Uint8Array;
  readonly lufs: number;
  readonly peakDb: number;
  readonly appliedGainDb: number;
  readonly limitingApplied: boolean;
  readonly issues: readonly QaIssue[];
}

/** Master the unmastered mix with the selected backend. */
export function masterTrack(
  mix: MixResult,
  options: MasterOptions = {},
): MasterResultOutput {
  const requested = options.backend ?? 'auto';
  const useFfmpeg =
    requested === 'ffmpeg' || (requested === 'auto' && ffmpegAvailable());
  if (requested === 'ffmpeg' && !ffmpegAvailable()) {
    throw new Error('masterTrack: ffmpeg backend requested but ffmpeg is not on PATH');
  }

  if (useFfmpeg) {
    return masterWithFfmpeg(mix, options.mp3 === true, options.targetLufs ?? TARGET_LUFS);
  }
  return masterWithPureTs(mix, options.targetLufs ?? TARGET_LUFS);
}

function masterWithPureTs(mix: MixResult, targetLufs: number): MasterResultOutput {
  const result = masterSamples(mix.samples, mix.sampleRate, targetLufs);
  const wav = encodeWavPcm16(result.samples, mix.sampleRate);
  return {
    backend: 'pure-ts',
    backendDetail: 'wflx-master-pure-ts@0.1.0 (BS.1770-4 integrated loudness, sample-peak ceiling)',
    wav,
    lufs: result.finalLufs,
    peakDb: result.finalPeakDb,
    appliedGainDb: result.appliedGainDb,
    limitingApplied: result.limitingApplied,
    issues: result.issues,
  };
}

function masterWithFfmpeg(
  mix: MixResult,
  withMp3: boolean,
  targetLufs: number,
): MasterResultOutput {
  const dir = mkdtempSync(join(tmpdir(), 'wflx-master-'));
  try {
    const inputPath = join(dir, 'mix.wav');
    const outPath = join(dir, 'master.wav');
    writeFileSync(inputPath, encodeWavPcm16(mix.samples, mix.sampleRate));
    const lufsArg = `loudnorm=I=${targetLufs}:TP=-1.5:LRA=11`;
    const run = runFfmpeg([
      '-i',
      inputPath,
      '-af',
      lufsArg,
      '-ar',
      String(MASTER_SAMPLE_RATE),
      '-ac',
      '1',
      '-c:a',
      'pcm_s16le',
      '-f',
      'wav',
      outPath,
    ]);
    if (!run.ok) {
      throw new Error(`masterTrack: ffmpeg failed: ${run.stderr}`);
    }
    const wav = new Uint8Array(readFileSync(outPath));
    const decoded = decodeWav(wav);
    let mp3: Uint8Array | undefined;
    if (withMp3) {
      const mp3Path = join(dir, 'master.mp3');
      const mp3Run = runFfmpeg([
        '-i',
        outPath,
        '-c:a',
        'libmp3lame',
        '-b:a',
        '128k',
        '-f',
        'mp3',
        mp3Path,
      ]);
      if (!mp3Run.ok) {
        throw new Error(`masterTrack: ffmpeg mp3 encode failed: ${mp3Run.stderr}`);
      }
      mp3 = new Uint8Array(readFileSync(mp3Path));
    }
    const lufs = measureIntegratedLufs(decoded.samples, decoded.sampleRate);
    const peakDb = samplePeakDb(decoded.samples);
    const issues: QaIssue[] = [];
    if (Number.isFinite(lufs) && Math.abs(lufs - targetLufs) > 1.5) {
      issues.push({
        severity: 'warning',
        code: 'loudness-off-target',
        message: `ffmpeg-mastered integrated loudness ${lufs.toFixed(2)} LUFS vs target ${targetLufs} LUFS`,
      });
    }
    return {
      backend: 'ffmpeg',
      backendDetail: `ffmpeg ${ffmpegVersion() ?? 'unknown'} loudnorm I=${targetLufs}:TP=-1.5:LRA=11`,
      wav,
      mp3,
      lufs,
      peakDb,
      appliedGainDb: 0, // applied inside the filter; not separable single-pass
      limitingApplied: false,
      issues,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
