/**
 * Compositor (WFLX-W3) — placeholder narration audio.
 *
 * The lab's canonical narration is a DETERMINISTIC PLACEHOLDER: silence with
 * a quiet marker tone at each narration segment start (frequency varies by
 * segment index). It exists so the composition is exercised end-to-end with
 * a real audio track and so scene/narration alignment is measurable offline
 * — exactly the position of W2's offline deterministic TTS (NOT product
 * parity evidence; real narration TTS routes through the W2 speech surface
 * at Phase 3 integration, per the work order's dependency graph).
 *
 * Also provides the minimal 16-bit PCM mono WAV encoder the video surface
 * needs (self-contained on purpose: worker trees compile independently).
 */

import type { Timeline } from './timeline';

export const NARRATION_SAMPLE_RATE = 44_100;

/** Encode Float32 samples in [-1, 1] as a 16-bit PCM mono WAV file. */
export function encodeWav16Mono(samples: Float32Array, sampleRate: number): Uint8Array {
  const dataBytes = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const writeAscii = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i += 1) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };
  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(36, 'data');
  view.setUint32(40, dataBytes, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(offset, Math.round(clamped * 32767), true);
    offset += 2;
  }
  return new Uint8Array(buffer);
}

export interface NarrationSegmentSpec {
  readonly segmentId: string;
  readonly sceneId: string;
  readonly startSeconds: number;
  /** Marker tone frequency hint (Hz); derived from position when omitted. */
  readonly frequencyHz?: number;
}

export interface PlaceholderNarrationResult {
  readonly wav: Uint8Array;
  readonly sampleRate: number;
  readonly durationSeconds: number;
  readonly markerAmplitude: number;
}

/**
 * Synthesize the placeholder narration track: silence with a 160 ms marker
 * tone (-28 dBFS) at each segment start. Pure and deterministic.
 */
export function synthesizePlaceholderNarration(
  timeline: Timeline,
  segments: readonly NarrationSegmentSpec[],
): PlaceholderNarrationResult {
  const sampleRate = NARRATION_SAMPLE_RATE;
  const totalSamples = Math.ceil(timeline.durationSeconds * sampleRate);
  const samples = new Float32Array(totalSamples);
  const amplitude = Math.pow(10, -28 / 20); // -28 dBFS
  const markerSamples = Math.round(0.16 * sampleRate);
  const fadeSamples = Math.round(0.004 * sampleRate);

  segments.forEach((segment, index) => {
    const startSample = Math.round(segment.startSeconds * sampleRate);
    const frequency =
      segment.frequencyHz ?? 392 + (index % 12) * 30; // deterministic scale walk
    for (let i = 0; i < markerSamples; i += 1) {
      const sampleIndex = startSample + i;
      if (sampleIndex >= totalSamples) {
        break;
      }
      const envelope =
        i < fadeSamples
          ? i / fadeSamples
          : i > markerSamples - fadeSamples
            ? (markerSamples - i) / fadeSamples
            : 1;
      samples[sampleIndex] =
        amplitude * envelope * Math.sin((2 * Math.PI * frequency * i) / sampleRate);
    }
  });

  return {
    wav: encodeWav16Mono(samples, sampleRate),
    sampleRate,
    durationSeconds: timeline.durationSeconds,
    markerAmplitude: amplitude,
  };
}
