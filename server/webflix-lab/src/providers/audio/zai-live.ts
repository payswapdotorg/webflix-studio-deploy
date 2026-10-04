/**
 * Speech provider (WFLX-P1, Deliverable A / EV-016) — ZAI live TTS adapter.
 *
 * A REAL production TTS execution path through the existing SpeechProvider
 * port: server-side `z-ai-web-dev-sdk` speech synthesis (a live network
 * service), selected via the env flag `WFLX_TTS_PROVIDER=live-zai`
 * (factory). The offline deterministic adapter remains the DEFAULT — zero
 * behavior change when the flag is unset.
 *
 * Binding rules honored (port.ts + AGENTS.md):
 * - NO credentials in code: the SDK authenticates from the ambient
 *   environment it is installed in (operator/TL-side wiring); this adapter
 *   declares NO required credential keys and never reads, logs or commits
 *   credential-shaped strings. Public, non-secret CONFIG (voice-name
 *   overrides, model id) may arrive via env — names only.
 * - Provider-specific request/response structures stay inside this module.
 * - The adapter NEVER fakes audio: transport/provider failures throw typed
 *   errors (never silently degrade to placeholder audio).
 * - HONEST BOUNDARY (LAB-06 discipline): live output is stochastic per
 *   call, like the real product. Byte-identity is NOT claimed for this
 *   provider — the port's determinism contract is satisfied by the offline
 *   path; this adapter records stable per-speaker voice PARAMETERS
 *   (`effectiveVoiceParams` is a pure function of the speaker's profile)
 *   so speaker-consistency QA stays meaningful, while the AUDIO bytes vary
 *   run to run.
 * - Input size limit: the service accepts <= 1024 characters per request;
 *   longer turn text is split at sentence boundaries (pure, exported
 *   helper) and the returned WAV chunks are PCM-concatenated into ONE
 *   payload per turn (smallest regenerable unit stays the TURN).
 */

import { decodeWav, encodeWavPcm16 } from '../../audio/mixing/wav';
import { fnv1a32 } from '../../audio/rng';
import type {
  AudioPayload,
  SpeakerId,
  SpeakerVoiceProfile,
  SpeechProvider,
  SpeechProviderCapabilities,
  SpeechTurnRequest,
  SpeechTurnResult,
} from './port';

/** Env var names (names only — never values) consumed by this adapter. */
export const ZAI_LIVE_TTS_ENV = {
  /** Factory activation flag handled in factory.ts (WFLX_TTS_PROVIDER). */
  provider: 'WFLX_TTS_PROVIDER',
  /** Optional model-id override (public identifier, not a secret). */
  model: 'WFLX_ZAI_TTS_MODEL',
  /** Optional per-role voice-name overrides (public names, not secrets). */
  voiceHostA: 'WFLX_ZAI_TTS_VOICE_HOST_A',
  voiceHostB: 'WFLX_ZAI_TTS_VOICE_HOST_B',
} as const;

/** Default model identifier the SDK route uses (public, not a secret). */
export const ZAI_LIVE_TTS_DEFAULT_MODEL = 'zai-tts-1';

/** Service audio format (OBSERVED via probe, 2026-10-01): WAV, 24 kHz, mono, 16-bit. */
export const ZAI_TTS_SAMPLE_RATE = 24000;

/** Service input limit (SDK contract): max characters per request. */
export const ZAI_TTS_MAX_INPUT_CHARS = 1024;

/** Service speed bounds (SDK contract). */
export const ZAI_TTS_SPEED_MIN = 0.5;
export const ZAI_TTS_SPEED_MAX = 2.0;

/** Neutral descriptor -> service voice mapping (deterministic, documented). */
export const ZAI_VOICE_BY_DESCRIPTOR: Readonly<Record<string, string>> = {
  'female-warm-analytical': 'tongtong', // warm, analytical female host (Ava)
  'male-grounded-analytical': 'xiaochen', // steady, professional voice (Ben)
  'neutral-visitor': 'kazi', // clear, standard visitor
  'neutral-narrator': 'luodo', // expressive narrator
};

/** Stable fallback pool for unmapped descriptors. */
export const ZAI_VOICE_FALLBACK_POOL: readonly string[] = [
  'tongtong',
  'xiaochen',
  'jam',
  'kazi',
  'douji',
  'luodo',
];

/**
 * Map a neutral voice descriptor (e.g. 'female-warm-analytical/en') onto a
 * concrete service voice id. Pure: identical descriptor -> identical voice.
 * Unmapped descriptors hash onto the fallback pool deterministically.
 */
export function zaiVoiceForDescriptor(descriptor: string): string {
  const base = descriptor.split('/')[0] ?? descriptor;
  const mapped = ZAI_VOICE_BY_DESCRIPTOR[base];
  if (mapped !== undefined) return mapped;
  return ZAI_VOICE_FALLBACK_POOL[fnv1a32(base) % ZAI_VOICE_FALLBACK_POOL.length] ?? 'tongtong';
}

/** Clamp a rate multiplier onto the service speed bounds. Pure. */
export function clampSpeed(rate: number | undefined): number {
  const value = rate === undefined || !Number.isFinite(rate) ? 1 : rate;
  return Math.min(ZAI_TTS_SPEED_MAX, Math.max(ZAI_TTS_SPEED_MIN, value));
}

/**
 * Split turn text into service-sized chunks at sentence boundaries (pure).
 * Greedy packing keeps whole sentences together; a sentence longer than the
 * limit is hard-split on word boundaries as the last resort. Always returns
 * at least one non-empty chunk for non-empty input.
 */
export function splitTextForService(text: string, maxChars: number = ZAI_TTS_MAX_INPUT_CHARS): string[] {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (trimmed.length === 0) return [];
  if (trimmed.length <= maxChars) return [trimmed];

  const sentences = trimmed.match(/[^.!?…]+[.!?…]+["')\]]*\s*|[^.!?…]+$/g) ?? [trimmed];
  const chunks: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    const piece = sentence.trim();
    if (piece.length === 0) continue;
    if (current.length === 0) {
      current = piece;
    } else if (current.length + 1 + piece.length <= maxChars) {
      current = `${current} ${piece}`;
    } else {
      chunks.push(current);
      current = piece;
    }
    while (current.length > maxChars) {
      // Hard-split an oversized sentence on word boundaries.
      let cut = current.lastIndexOf(' ', maxChars);
      if (cut <= 0) cut = maxChars;
      chunks.push(current.slice(0, cut));
      current = current.slice(cut).trim();
    }
  }
  if (current.length > 0) chunks.push(current);
  return chunks.filter((chunk) => chunk.length > 0);
}

/** Minimal typed shape of the SDK client surface this adapter consumes. */
interface ZaiTtsClient {
  audio: {
    tts: {
      create: (body: {
        input: string;
        voice?: string;
        speed?: number;
        response_format?: string;
        stream?: boolean;
      }) => Promise<unknown>;
    };
  };
}

/** Constructor options for the live adapter. */
export interface ZaiLiveTtsOptions {
  /** SDK client factory override (tests inject a fake; production uses ZAI.create()). */
  readonly clientFactory?: () => Promise<ZaiTtsClient>;
  /** Model id override (public identifier). */
  readonly model?: string;
  /** Per-role voice-name overrides (public names). */
  readonly voiceOverrides?: Readonly<Partial<Record<SpeakerId, string>>>;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  readonly env?: NodeJS.ProcessEnv;
}

/** Error kinds for typed failures (never silently degrade). */
export type ZaiLiveTtsErrorKind =
  | 'missing-voice-profile'
  | 'empty-text'
  | 'transport'
  | 'provider-rejected'
  | 'invalid-audio';

export interface ZaiLiveTtsError {
  readonly kind: ZaiLiveTtsErrorKind;
  readonly detail: string;
}

export class ZaiLiveTts implements SpeechProvider {
  readonly id = 'zai-live-tts' as const;
  readonly kind = 'remote-single-speaker' as const;

  /** Public model identity recorded in artifact provenance (no secrets). */
  readonly modelId: string;

  private readonly clientFactory: () => Promise<ZaiTtsClient>;
  private readonly voiceOverrides: Readonly<Partial<Record<SpeakerId, string>>>;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private client: ZaiTtsClient | undefined;

  constructor(options: ZaiLiveTtsOptions = {}, env: NodeJS.ProcessEnv = process.env) {
    this.clientFactory =
      options.clientFactory ??
      (async () => {
        // Server-side SDK import only (never client-side; binding rule).
        const { default: ZAI } = (await import('z-ai-web-dev-sdk')) as {
          default: { create(): Promise<ZaiTtsClient> };
        };
        return ZAI.create();
      });
    this.modelId =
      options.model ??
      env[ZAI_LIVE_TTS_ENV.model] ??
      ZAI_LIVE_TTS_DEFAULT_MODEL;
    this.voiceOverrides = {
      ...(env[ZAI_LIVE_TTS_ENV.voiceHostA] !== undefined
        ? { 'host-a': env[ZAI_LIVE_TTS_ENV.voiceHostA] as string }
        : {}),
      ...(env[ZAI_LIVE_TTS_ENV.voiceHostB] !== undefined
        ? { 'host-b': env[ZAI_LIVE_TTS_ENV.voiceHostB] as string }
        : {}),
      ...options.voiceOverrides,
    };
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.maxRetries = options.maxRetries ?? 2;
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

  /**
   * No credential keys: the SDK authenticates from the ambient runtime
   * environment (operator wiring); this adapter never touches secrets.
   */
  requiredCredentialKeys(): readonly string[] {
    return [];
  }

  /** Voice identity for a speaker: pure function of (profile, overrides). */
  private voiceFor(profile: SpeakerVoiceProfile, speakerId: SpeakerId): string {
    const override = this.voiceOverrides[speakerId];
    if (override !== undefined && override.length > 0) return override;
    return zaiVoiceForDescriptor(profile.voice);
  }

  private async ensureClient(): Promise<ZaiTtsClient> {
    if (this.client === undefined) {
      this.client = await this.clientFactory();
    }
    return this.client;
  }

  /** One service call -> WAV bytes. Retries transport errors. Throws typed. */
  private async synthesizeChunk(
    client: ZaiTtsClient,
    input: string,
    voice: string,
    speed: number,
  ): Promise<Uint8Array> {
    let lastError: ZaiLiveTtsError | undefined;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        const response = await withTimeout(
          client.audio.tts.create({
            input,
            voice,
            speed,
            response_format: 'wav',
            stream: false,
          }),
          this.timeoutMs,
        );
        if (!isResponseLike(response)) {
          throw this.asError({
            kind: 'provider-rejected',
            detail: `service returned a non-Response object (${typeof response})`,
          });
        }
        if (response.status < 200 || response.status >= 300) {
          throw this.asError({
            kind: 'provider-rejected',
            detail: `HTTP ${response.status}`,
          });
        }
        const buffer = await response.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        if (bytes.byteLength < 44) {
          throw this.asError({
            kind: 'invalid-audio',
            detail: `service returned ${bytes.byteLength} bytes (too short for a WAV header)`,
          });
        }
        return bytes;
      } catch (cause) {
        if (isZaiError(cause)) {
          lastError = cause;
        } else {
          lastError = this.asError({
            kind: 'transport',
            detail: `request failed: ${String(cause)}`,
          });
        }
        if (attempt < this.maxRetries) {
          await sleep(250 * (attempt + 1));
        }
      }
    }
    throw lastError ??
      this.asError({ kind: 'transport', detail: 'synthesis failed without a recorded cause' });
  }

  async synthesizeTurn(
    request: SpeechTurnRequest,
    voices: ReadonlyMap<SpeakerId, SpeakerVoiceProfile>,
  ): Promise<SpeechTurnResult> {
    const profile = voices.get(request.speakerId);
    if (profile === undefined) {
      throw this.asError({
        kind: 'missing-voice-profile',
        detail: `no voice profile for speaker '${request.speakerId}'`,
      });
    }
    const chunks = splitTextForService(request.text);
    if (chunks.length === 0) {
      throw this.asError({ kind: 'empty-text', detail: `turn ${request.turnId} has empty text` });
    }

    const voice = this.voiceFor(profile, request.speakerId);
    const speed = clampSpeed(profile.rate);

    const client = await this.ensureClient();
    const chunkBytes: Uint8Array[] = [];
    for (const chunk of chunks) {
      chunkBytes.push(await this.synthesizeChunk(client, chunk, voice, speed));
    }

    // PCM-concatenate the chunk WAVs into ONE payload for the turn (the
    // service emits 24 kHz mono s16 WAV; verified by decodeWav).
    let samples: Float64Array = new Float64Array(0);
    let sampleRate = ZAI_TTS_SAMPLE_RATE;
    for (const bytes of chunkBytes) {
      const decoded = decodeWav(bytes);
      if (decoded.sampleRate !== ZAI_TTS_SAMPLE_RATE || decoded.samples.length === 0) {
        throw this.asError({
          kind: 'invalid-audio',
          detail: `chunk WAV unexpected: sampleRate=${decoded.sampleRate}, ${decoded.samples.length} samples`,
        });
      }
      sampleRate = decoded.sampleRate;
      const merged = new Float64Array(samples.length + decoded.samples.length);
      merged.set(samples, 0);
      merged.set(decoded.samples, samples.length);
      samples = merged;
    }

    const wav = encodeWavPcm16(samples, sampleRate);
    const payload: AudioPayload = {
      data: wav,
      container: 'wav',
      sampleRate,
      channels: 1,
      bitsPerSample: 16,
    };

    // Stable per (provider, speaker): pure function of the profile —
    // per-turn variation (chunk counts, byte sizes) deliberately excluded
    // so speaker-consistency QA keys on voice identity, not text length.
    const effectiveVoiceParams: Readonly<Record<string, unknown>> = {
      engine: this.id,
      sdk: 'z-ai-web-dev-sdk',
      model: this.modelId,
      voice,
      speed,
      volume: profile.volume ?? 1,
    };

    return {
      turnId: request.turnId,
      audio: payload,
      durationSeconds: samples.length / sampleRate,
      effectiveVoiceParams,
    };
  }

  /** Sequential per-turn synthesis (no native multi-speaker mode). */
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

  /** Liveness probe: synthesize a tiny phrase through the REAL service. */
  async healthCheck(): Promise<{ ok: boolean; detail?: string }> {
    try {
      const client = await this.ensureClient();
      const bytes = await this.synthesizeChunk(client, 'probe', 'tongtong', 1);
      const decoded = decodeWav(bytes);
      return {
        ok: true,
        detail: `live: ${bytes.byteLength} bytes, ${decoded.sampleRate} Hz, ${(decoded.samples.length / decoded.sampleRate).toFixed(2)} s`,
      };
    } catch (cause) {
      return { ok: false, detail: String(cause) };
    }
  }

  dispose(): void {
    this.client = undefined;
  }

  asError(error: ZaiLiveTtsError): ZaiLiveTtsError & Error {
    const err = new Error(`zai-live-tts: ${error.kind}: ${error.detail}`) as Error &
      MutableErrorFields;
    err.kind = error.kind;
    err.detail = error.detail;
    err.name = 'ZaiLiveTtsError';
    return err as ZaiLiveTtsError & Error;
  }
}

// ---------------------------------------------------------------------------
// Small local helpers
// ---------------------------------------------------------------------------

/** Writable view used when stamping typed fields onto an Error instance. */
interface MutableErrorFields {
  kind?: ZaiLiveTtsErrorKind;
  detail?: string;
}

function isResponseLike(value: unknown): value is { status: number; arrayBuffer(): Promise<ArrayBuffer> } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { status?: unknown }).status === 'number' &&
    typeof (value as { arrayBuffer?: unknown }).arrayBuffer === 'function'
  );
}

function isZaiError(value: unknown): value is ZaiLiveTtsError {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { kind?: unknown }).kind === 'string' &&
    (value as { name?: unknown }).name === 'ZaiLiveTtsError'
  );
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs} ms`)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (cause) => {
        clearTimeout(timer);
        reject(cause);
      },
    );
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
