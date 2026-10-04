/**
 * Audio pipeline (WFLX-W2, Stage 2) — minimal WAV codec (PCM 16-bit).
 *
 * The pipeline's common format is PCM 16-bit, 44.1 kHz, mono (DESIGN.md §8).
 * This module encodes/decodes that format (plus tolerant decoding of other
 * sample rates / channel counts), and provides the linear resampler used to
 * normalize provider payloads into the common format before mixing.
 */

/** Anything indexable as PCM samples (Float64Array or plain arrays). */
export type SampleSource = Float64Array | readonly number[];

/** Decoded WAV payload (mono-mixed float samples in [-1, 1]). */
export interface DecodedWav {
  readonly samples: Float64Array;
  readonly sampleRate: number;
  readonly channels: number;
  readonly bitsPerSample: number;
}

/** Encode float samples in [-1, 1] as a 16-bit PCM mono WAV file. */
export function encodeWavPcm16(samples: SampleSource, sampleRate: number): Uint8Array {
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
  view.setUint32(16, 16, true); // fmt chunk size
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
    const sample = samples[i] ?? 0;
    const clamped = Math.max(-1, Math.min(1, sample));
    // Round-to-nearest with symmetric clipping to int16.
    view.setInt16(offset, Math.round(clamped * 32767), true);
    offset += 2;
  }
  return new Uint8Array(buffer);
}

/** Decode a RIFF/WAVE file (PCM 16-bit or 8-bit; any channel count) to mono floats. */
export function decodeWav(bytes: Uint8Array): DecodedWav {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (offset: number, length: number): string => {
    let out = '';
    for (let i = 0; i < length; i += 1) {
      out += String.fromCharCode(view.getUint8(offset + i));
    }
    return out;
  };
  if (bytes.byteLength < 44 || ascii(0, 4) !== 'RIFF' || ascii(8, 4) !== 'WAVE') {
    throw new Error('decodeWav: not a RIFF/WAVE buffer');
  }

  let sampleRate = 0;
  let channels = 0;
  let bitsPerSample = 0;
  let dataOffset = -1;
  let dataLength = 0;

  let offset = 12;
  while (offset + 8 <= bytes.byteLength) {
    const chunkId = ascii(offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    if (chunkId === 'fmt ') {
      const format = view.getUint16(offset + 8, true);
      if (format !== 1) {
        throw new Error(`decodeWav: unsupported format tag ${format} (PCM only)`);
      }
      channels = view.getUint16(offset + 10, true);
      sampleRate = view.getUint32(offset + 12, true);
      bitsPerSample = view.getUint16(offset + 22, true);
    } else if (chunkId === 'data') {
      dataOffset = offset + 8;
      dataLength = Math.min(chunkSize, bytes.byteLength - dataOffset);
    }
    offset += 8 + chunkSize + (chunkSize % 2);
  }

  if (dataOffset < 0 || sampleRate === 0 || channels === 0 || bitsPerSample === 0) {
    throw new Error('decodeWav: missing fmt or data chunk');
  }
  if (bitsPerSample !== 16 && bitsPerSample !== 8) {
    throw new Error(`decodeWav: unsupported bits per sample ${bitsPerSample}`);
  }

  const bytesPerSample = bitsPerSample / 8;
  const frameCount = Math.floor(dataLength / (bytesPerSample * channels));
  const samples = new Float64Array(frameCount);
  for (let frame = 0; frame < frameCount; frame += 1) {
    let acc = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      const pos = dataOffset + (frame * channels + channel) * bytesPerSample;
      if (bitsPerSample === 16) {
        acc += view.getInt16(pos, true) / 32768;
      } else {
        acc += (view.getUint8(pos) - 128) / 128;
      }
    }
    samples[frame] = acc / channels;
  }
  return { samples, sampleRate, channels, bitsPerSample };
}

/** Interpret raw little-endian int16 bytes as mono float samples. */
export function pcm16ToFloats(bytes: Uint8Array): Float64Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = Math.floor(bytes.byteLength / 2);
  const samples = new Float64Array(count);
  for (let i = 0; i < count; i += 1) {
    samples[i] = view.getInt16(i * 2, true) / 32768;
  }
  return samples;
}

/** Linear-interpolation resampler (deterministic; quality is documented as limited). */
export function resampleLinear(samples: SampleSource, fromRate: number, toRate: number): Float64Array {
  if (fromRate === toRate) {
    return Float64Array.from(samples);
  }
  const ratio = toRate / fromRate;
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
