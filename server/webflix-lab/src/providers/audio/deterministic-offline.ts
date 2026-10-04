/**
 * Speech provider (WFLX-W2, Stage 2) — DeterministicOfflineTtsAdapter.
 *
 * The canonical credential-free test path (src/providers/audio/README.md
 * rule 4): pure-TS synthesized placeholder audio with EXACT per-turn
 * durations so the entire pipeline (compile -> speak -> time -> mix -> master
 * -> QA) runs without network or credentials (DESIGN.md §7).
 *
 * The placeholder is a layered-sine "voice hum": a stable base frequency per
 * speaker (derived from the voice descriptor), two harmonics, a seeded
 * amplitude LFO, a small seeded frequency wobble and an attack/release
 * envelope. Every parameter is a pure function of
 * (seed, turnId, speakerId, text hash, voice profile) — identical inputs
 * produce byte-identical WAVs; different seeds/turns/speakers are audibly
 * distinguishable. This is NOT speech: artifacts honestly say so in their
 * provenance notes, and fixture-only success is not product parity evidence
 * (AGENTS.md).
 */

import { fnv1a32 } from '../../audio/rng';
import { encodeWavPcm16 } from '../../audio/mixing/wav';
import type {
  AudioPayload,
  SpeakerId,
  SpeakerVoiceProfile,
  SpeechProvider,
  SpeechProviderCapabilities,
  SpeechTurnRequest,
  SpeechTurnResult,
} from './port';

/** Common output format: PCM 16-bit, 44.1 kHz, mono. */
export const OFFLINE_SAMPLE_RATE = 44100;

/** Options for the offline deterministic adapter (seed accepts strings). */
export interface DeterministicOfflineTtsOptions {
  /** Deterministic seed; identical seeds produce byte-identical audio. */
  readonly seed?: string | number;
  /** Fixed default 44100. */
  readonly sampleRate?: number;
}

export class DeterministicOfflineTtsAdapter implements SpeechProvider {
  readonly id = 'deterministic-offline-tts';
  readonly kind = 'offline-deterministic' as const;

  private readonly sampleRate: number;
  private readonly seed: number;

  constructor(options: DeterministicOfflineTtsOptions = {}) {
    this.sampleRate = options.sampleRate ?? OFFLINE_SAMPLE_RATE;
    const seedText = options.seed !== undefined ? String(options.seed) : 'wflx-offline-tts';
    this.seed = fnv1a32(seedText);
  }

  capabilities(): SpeechProviderCapabilities {
    return {
      nativeMultiSpeaker: false,
      maxSpeakers: 8,
      perSpeakerVoiceParams: true,
      supportsPronunciationHints: false,
      supportsCrossTurnConditioning: false,
      containers: ['wav'],
    };
  }

  requiredCredentialKeys(): readonly string[] {
    return [];
  }

  /**
   * Stable base frequency for a speaker: pure function of the voice
   * descriptor string (e.g. 'female-warm-analytical/en'), 110–200 Hz.
   */
  private baseHzFor(profile: SpeakerVoiceProfile): number {
    return 110 + (fnv1a32(profile.voice) % 91);
  }

  synthesizeTurn(
    request: SpeechTurnRequest,
    voices: ReadonlyMap<SpeakerId, SpeakerVoiceProfile>,
  ): Promise<SpeechTurnResult> {
    const profile = voices.get(request.speakerId);
    if (profile === undefined) {
      return Promise.reject(
        new Error(`deterministic-offline-tts: no voice profile for speaker '${request.speakerId}'`),
      );
    }
    const targetSeconds = request.targetSeconds ?? 2.5;
    const nSamples = Math.max(1, Math.round(targetSeconds * this.sampleRate));
    const baseHz = this.baseHzFor(profile);

    const turnSeed = fnv1a32(
      `${this.seed}|${request.turnId}|${request.speakerId}|${fnv1a32(request.text)}`,
    );
    const lfoHz = 0.4 + (turnSeed % 97) / 100;
    const wobbleHz = 2.5 + (turnSeed % 13) / 5;
    const wobbleDepth = 0.004 + (turnSeed % 7) / 1000;

    const samples = new Float64Array(nSamples);
    const attack = Math.round(0.015 * this.sampleRate);
    const release = Math.round(0.025 * this.sampleRate);
    for (let i = 0; i < nSamples; i += 1) {
      const t = i / this.sampleRate;
      // Amplitude envelope: attack/release + slow conversational LFO.
      let envelope = 1;
      if (i < attack) envelope = i / attack;
      else if (i > nSamples - release) envelope = Math.max(0, (nSamples - i) / release);
      const lfo = 0.75 + 0.25 * Math.sin(2 * Math.PI * lfoHz * t + (turnSeed % 100) / 15);
      // Frequency wobble makes consecutive turns audibly distinct.
      const wobble = 1 + wobbleDepth * Math.sin(2 * Math.PI * wobbleHz * t + turnSeed);
      const carrier =
        Math.sin(2 * Math.PI * baseHz * wobble * t) +
        0.35 * Math.sin(2 * Math.PI * baseHz * 2 * wobble * t + 0.7) +
        0.15 * Math.sin(2 * Math.PI * baseHz * 3 * wobble * t + 1.9);
      samples[i] = 0.3 * envelope * lfo * carrier;
    }

    const wav = encodeWavPcm16(samples, this.sampleRate);
    const payload: AudioPayload = {
      data: wav,
      container: 'wav',
      sampleRate: this.sampleRate,
      channels: 1,
      bitsPerSample: 16,
    };
    const result: SpeechTurnResult = {
      turnId: request.turnId,
      audio: payload,
      durationSeconds: nSamples / this.sampleRate,
      effectiveVoiceParams: {
        voice: profile.voice,
        rate: profile.rate ?? 1,
        pitch: profile.pitch ?? 1,
        volume: profile.volume ?? 1,
        baseHz,
        harmonics: 3,
        engine: this.id,
      },
    };
    return Promise.resolve(result);
  }

  /** Ordered sequence of per-turn synthesis (no native multi-speaker mode). */
  async synthesizeDialogue(
    dialogue: readonly SpeechTurnRequest[],
    voices: ReadonlyMap<SpeakerId, SpeakerVoiceProfile>,
  ): Promise<readonly SpeechTurnResult[]> {
    const out: SpeechTurnResult[] = [];
    for (const request of dialogue) {
      out.push(await this.synthesizeTurn(request, voices));
    }
    return out;
  }
}
