/**
 * Speech provider (WFLX-W2, Stage 2) — Gemini-style multi-speaker TTS adapter
 * (thin implementation behind an env flag).
 *
 * Implements the `GeminiMultiSpeakerTtsAdapter` interface shaped in
 * gemini-multi-speaker.ts (Stage 1). DOCUMENTED basis: Gemini native audio
 * supports expressive multi-speaker conversations with natural-language style
 * steering, returning inline PCM (docs/notebooklm-overviews-research.md).
 *
 * Binding rules honored here:
 * - NO credentials in code: the API key is constructor- or env-injected
 *   (`GEMINI_API_KEY`); `requiredCredentialKeys()` declares the name only.
 *   Missing credentials throw a typed `missing-credentials` error — the
 *   adapter never fakes audio.
 * - Provider-specific request/response structures stay inside this module.
 * - Pure mapping helpers (`buildMultiSpeakerRequest`,
 *   `parseMultiSpeakerResponse`) are exported for offline unit tests; the
 *   transport is a thin fetch. Real dispatch is TL-side wiring: the lab's
 *   canonical test path is the offline deterministic adapter, and this
 *   adapter's live behavior against the real endpoint is UNRESOLVED until a
 *   TL-operated run records evidence.
 * - Response turn alignment: the adapter requires `turnSegments` covering the
 *   returned audio; responses without usable alignment throw
 *   `alignment-mismatch` (callers then fall back to per-turn synthesis
 *   through `synthesizeTurn`).
 */

import type {
  GeminiAdapterError,
  GeminiMultiSpeakerRequest,
  GeminiMultiSpeakerResponse,
  GeminiMultiSpeakerTtsAdapter,
  GeminiVoiceConfig,
} from './gemini-multi-speaker';
import type {
  AudioPayload,
  SpeakerId,
  SpeakerVoiceProfile,
  SpeechTurnRequest,
  SpeechTurnResult,
} from './port';

/** Env var names (names only — never values) consumed by this adapter. */
export const GEMINI_ADAPTER_ENV = {
  apiKey: 'GEMINI_API_KEY',
  endpoint: 'WFLX_GEMINI_TTS_ENDPOINT',
  model: 'WFLX_GEMINI_TTS_MODEL',
} as const;

/** Default model identifier (public, not a secret; overridable). */
export const GEMINI_DEFAULT_MODEL = 'gemini-2.5-flash-preview-tts';

/** Default endpoint base (public API surface, not a secret; overridable). */
export const GEMINI_DEFAULT_ENDPOINT = 'https://generativelanguage.googleapis.com';

export interface GeminiMultiSpeakerAdapterOptions {
  /** API key; falls back to env GEMINI_API_KEY. Never logged or committed. */
  readonly apiKey?: string;
  /** Endpoint base; falls back to env WFLX_GEMINI_TTS_ENDPOINT. */
  readonly endpoint?: string;
  /** Model id; falls back to env WFLX_GEMINI_TTS_MODEL. */
  readonly model?: string;
  readonly sampleRate?: 24000 | 48000;
  readonly timeoutMs?: number;
}

interface GeminiApiTextPart {
  readonly text: string;
}
interface GeminiApiInlinePart {
  readonly inlineData: { readonly mimeType: string; readonly data: string };
}
type GeminiApiPart = GeminiApiTextPart | GeminiApiInlinePart;

/** Provider-internal generateContent request body (stays inside this module). */
interface GeminiApiRequestBody {
  readonly contents: { readonly role: string; readonly parts: GeminiApiPart[] }[];
  readonly generationConfig: {
    readonly responseModalities: string[];
    readonly speechConfig?: {
      readonly multiSpeakerVoiceConfig?: {
        readonly speakerVoiceConfigs: {
          readonly speaker: string;
          readonly voiceConfig: { readonly prebuiltVoiceConfig: { readonly voiceName: string } };
        }[];
      };
    };
  };
}

export class GeminiMultiSpeakerTts
  implements GeminiMultiSpeakerTtsAdapter
{
  readonly id = 'gemini-multi-speaker-tts' as const;
  readonly kind = 'remote-multi-speaker' as const;

  private readonly apiKey: string | undefined;
  private readonly endpointBase: string;
  private readonly model: string;
  private readonly sampleRate: 24000 | 48000;
  private readonly timeoutMs: number;

  constructor(options: GeminiMultiSpeakerAdapterOptions = {}, env: NodeJS.ProcessEnv = process.env) {
    this.apiKey = options.apiKey ?? env[GEMINI_ADAPTER_ENV.apiKey];
    this.endpointBase = (
      options.endpoint ??
      env[GEMINI_ADAPTER_ENV.endpoint] ??
      GEMINI_DEFAULT_ENDPOINT
    ).replace(/\/+$/, '');
    this.model = options.model ?? env[GEMINI_ADAPTER_ENV.model] ?? GEMINI_DEFAULT_MODEL;
    this.sampleRate = options.sampleRate ?? 24000;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  capabilities() {
    return {
      nativeMultiSpeaker: true,
      maxSpeakers: 2,
      perSpeakerVoiceParams: true,
      supportsPronunciationHints: false,
      supportsCrossTurnConditioning: true,
      containers: ['pcm-raw'] as const,
    };
  }

  requiredCredentialKeys(): readonly string[] {
    return [GEMINI_ADAPTER_ENV.apiKey];
  }

  // -------------------------------------------------------------------------
  // Pure mapping (offline-testable)
  // -------------------------------------------------------------------------

  buildMultiSpeakerRequest(
    dialogue: readonly SpeechTurnRequest[],
    voices: ReadonlyMap<SpeakerId, SpeakerVoiceProfile>,
    styleInstruction?: string,
  ): GeminiMultiSpeakerRequest {
    const speakers: GeminiVoiceConfig[] = [];
    for (const [speakerId, profile] of voices) {
      speakers.push({
        speakerId,
        // Adapter-internal mapping: neutral voice descriptor -> prebuilt name.
        voiceName: profile.voice.split('/')[0] ?? 'default',
        rate: profile.rate,
        pitch: profile.pitch,
      });
    }
    const lines = dialogue.map((turn) => ({
      speakerId: turn.speakerId,
      text: turn.text,
      pronunciation: turn.pronunciationHints?.map((hint) => `${hint.token} -> ${hint.say}`),
    }));
    return {
      model: this.model,
      dialogue: lines,
      speakers,
      styleInstruction,
      sampleRate: this.sampleRate,
    };
  }

  parseMultiSpeakerResponse(
    response: GeminiMultiSpeakerResponse,
    dialogue: readonly SpeechTurnRequest[],
  ): readonly SpeechTurnResult[] {
    if (dialogue.length === 0) {
      throw this.asError({ kind: 'alignment-mismatch', detail: 'empty dialogue' });
    }
    // Segments must be ordered, non-overlapping, and cover the dialogue.
    const segments = [...response.turnSegments].sort((a, b) => a.startMs - b.startMs);
    if (segments.length !== dialogue.length) {
      throw this.asError({
        kind: 'alignment-mismatch',
        detail: `expected ${dialogue.length} turn segments, got ${segments.length}`,
      });
    }
    let previousEnd = 0;
    const results: SpeechTurnResult[] = [];
    dialogue.forEach((turn, i) => {
      const segment = segments[i];
      if (segment === undefined || segment.turnId !== turn.turnId) {
        throw this.asError({
          kind: 'alignment-mismatch',
          detail: `segment ${i} does not match turn ${turn.turnId}`,
        });
      }
      if (segment.startMs < previousEnd || segment.endMs <= segment.startMs) {
        throw this.asError({
          kind: 'alignment-mismatch',
          detail: `segment for ${turn.turnId} overlaps or is empty`,
        });
      }
      previousEnd = segment.endMs;
      results.push({
        turnId: turn.turnId,
        audio: response.audio,
        durationSeconds: (segment.endMs - segment.startMs) / 1000,
        effectiveVoiceParams: { engine: this.id, model: response.model ?? this.model },
      });
    });
    return results;
  }

  // -------------------------------------------------------------------------
  // Transport (thin; requires credentials; never fakes audio)
  // -------------------------------------------------------------------------

  private assertCredentials(): void {
    if (this.apiKey === undefined || this.apiKey.length === 0) {
      throw this.asError({
        kind: 'missing-credentials',
        detail: `${GEMINI_ADAPTER_ENV.apiKey} is not set; inject credentials via constructor or env (never commit them)`,
      });
    }
  }

  private toApiBody(
    request: GeminiMultiSpeakerRequest,
  ): GeminiApiRequestBody {
    const speakerConfigs = request.speakers.map((speaker) => ({
      speaker: speaker.speakerId,
      voiceConfig: { prebuiltVoiceConfig: { voiceName: speaker.voiceName } },
    }));
    const parts: GeminiApiPart[] = [];
    if (request.styleInstruction !== undefined && request.styleInstruction.length > 0) {
      parts.push({ text: `${request.styleInstruction}\n\n` });
    }
    for (const line of request.dialogue) {
      const pronunciation =
        line.pronunciation !== undefined && line.pronunciation.length > 0
          ? ` (say: ${line.pronunciation.join('; ')})`
          : '';
      parts.push({ text: `${line.speakerId}: ${line.text}${pronunciation}\n` });
    }
    return {
      contents: [{ role: 'user', parts }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          multiSpeakerVoiceConfig: { speakerVoiceConfigs: speakerConfigs },
        },
      },
    };
  }

  async synthesizeDialogue(
    dialogue: readonly SpeechTurnRequest[],
    voices: ReadonlyMap<SpeakerId, SpeakerVoiceProfile>,
    styleInstruction?: string,
  ): Promise<readonly SpeechTurnResult[]> {
    this.assertCredentials();
    const request = this.buildMultiSpeakerRequest(dialogue, voices, styleInstruction);
    const url = `${this.endpointBase}/v1beta/models/${request.model}:generateContent`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': this.apiKey as string,
        },
        body: JSON.stringify(this.toApiBody(request)),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (cause) {
      throw this.asError({ kind: 'transport', detail: `request failed: ${String(cause)}` });
    }
    if (!response.ok) {
      throw this.asError({
        kind: 'provider-rejected',
        detail: `HTTP ${response.status}`,
      });
    }
    const body = (await response.json()) as {
      candidates?: { content?: { parts?: GeminiApiPart[] } }[];
    };
    const parts = body.candidates?.[0]?.content?.parts ?? [];
    const audioChunks: string[] = [];
    for (const part of parts) {
      if ('inlineData' in part && part.inlineData.data.length > 0) {
        audioChunks.push(part.inlineData.data);
      }
    }
    if (audioChunks.length === 0) {
      throw this.asError({ kind: 'provider-rejected', detail: 'response carried no inline audio' });
    }
    // The generateContent response carries inline audio but no per-turn
    // timestamps, so honest turn attribution is impossible: refuse to guess
    // alignment. Callers regenerate per turn via synthesizeTurn (smallest
    // regenerable unit) until a provider-side alignment path exists
    // (UNRESOLVED; TL-side wiring decides).
    throw this.asError({
      kind: 'alignment-mismatch',
      detail:
        'whole-dialogue responses carry no per-turn timestamps; use synthesizeTurn per turn (smallest regenerable unit) until alignment is available',
    });
  }

  async synthesizeTurn(
    request: SpeechTurnRequest,
    voices: ReadonlyMap<SpeakerId, SpeakerVoiceProfile>,
  ): Promise<SpeechTurnResult> {
    this.assertCredentials();
    const profile = voices.get(request.speakerId);
    if (profile === undefined) {
      throw this.asError({
        kind: 'provider-rejected',
        detail: `no voice profile for speaker '${request.speakerId}'`,
      });
    }
    const dialogue: SpeechTurnRequest[] = [request];
    const built = this.buildMultiSpeakerRequest(dialogue, voices, undefined);
    const url = `${this.endpointBase}/v1beta/models/${built.model}:generateContent`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': this.apiKey as string,
        },
        body: JSON.stringify(this.toApiBody(built)),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (cause) {
      throw this.asError({ kind: 'transport', detail: `request failed: ${String(cause)}` });
    }
    if (!response.ok) {
      throw this.asError({ kind: 'provider-rejected', detail: `HTTP ${response.status}` });
    }
    const body = (await response.json()) as {
      candidates?: { content?: { parts?: GeminiApiPart[] } }[];
    };
    const parts = body.candidates?.[0]?.content?.parts ?? [];
    const audioChunks: string[] = [];
    for (const part of parts) {
      if ('inlineData' in part && part.inlineData.data.length > 0) {
        audioChunks.push(part.inlineData.data);
      }
    }
    if (audioChunks.length === 0) {
      throw this.asError({ kind: 'provider-rejected', detail: 'response carried no inline audio' });
    }
    const pcm = base64ToBytes(audioChunks.join(''));
    const audio: AudioPayload = {
      data: pcm,
      container: 'pcm-raw',
      sampleRate: built.sampleRate,
      channels: 1,
      bitsPerSample: 16,
    };
    const durationSeconds = pcm.byteLength / 2 / built.sampleRate;
    return {
      turnId: request.turnId,
      audio,
      durationSeconds,
      effectiveVoiceParams: { engine: this.id, model: built.model },
    };
  }

  async healthCheck(): Promise<{ ok: boolean; detail?: string }> {
    if (this.apiKey === undefined || this.apiKey.length === 0) {
      return { ok: false, detail: `${GEMINI_ADAPTER_ENV.apiKey} not set` };
    }
    return { ok: true, detail: `configured for ${this.endpointBase}` };
  }

  asError(error: GeminiAdapterError): GeminiAdapterError & Error {
    const err = new Error(`gemini-multi-speaker-tts: ${error.kind}: ${error.detail}`) as
      GeminiAdapterError & Error;
    err.kind = error.kind;
    err.detail = error.detail;
    err.name = 'GeminiAdapterError';
    return err;
  }
}

function base64ToBytes(base64: string): Uint8Array {
  return new Uint8Array(Buffer.from(base64, 'base64'));
}
