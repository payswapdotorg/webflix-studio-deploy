/**
 * Gemini-style multi-speaker TTS adapter — INTERFACE ONLY (Stage 1).
 *
 * Shapes the adapter boundary for a Gemini-style native multi-speaker speech
 * API: one request carries the full two-host dialogue with per-speaker voice
 * configs, and the response returns inline audio plus per-turn alignment.
 *
 * DESIGN NOTES (DOCUMENTED, from official Gemini speech-generation materials
 * collected in docs/notebooklm-overviews-research.md):
 * - Gemini native audio supports expressive multi-speaker conversations,
 *   including NotebookLM-style two-person overviews.
 * - Style can be steered through natural-language instructions.
 * - Audio is returned inline (PCM), typically at 24 kHz or 48 kHz.
 *
 * IMPLEMENTATION RULES (binding):
 * - Implementation lands in Stage 2 as a THIN adapter. Endpoint URLs, model
 *   names, and auth are constructor-injected; NO credentials in code.
 * - The request/response structs in this file are provider-specific and stay
 *   inside this adapter module — they are NOT part of the shared contracts.
 * - `buildMultiSpeakerRequest` and `parseMultiSpeakerResponse` are pure
 *   mapping functions exposed for offline unit testing without network.
 * - Real dispatch requires TL-side credential wiring (a later TL stage).
 *   Without credentials the adapter must throw a typed error, never fake
 *   audio.
 */

import type {
  AudioPayload,
  SpeakerId,
  SpeakerVoiceProfile,
  SpeechProvider,
  SpeechProviderOptions,
  SpeechTurnRequest,
  SpeechTurnResult,
} from './port';

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

/** Constructor options for the Gemini multi-speaker adapter. */
export interface GeminiMultiSpeakerOptions extends SpeechProviderOptions {
  /** Model identifier, injected by TL-side wiring. */
  readonly model?: string;
  /** Response audio sample rate preference. */
  readonly sampleRate?: 24000 | 48000;
}

// ---------------------------------------------------------------------------
// Provider-specific request shape (stays inside this module)
// ---------------------------------------------------------------------------

/** Per-speaker voice config for one multi-speaker request. */
export interface GeminiVoiceConfig {
  readonly speakerId: SpeakerId;
  /** Prebuilt voice identifier, e.g. a named persona voice. */
  readonly voiceName: string;
  readonly rate?: number;
  readonly pitch?: number;
}

/** One line of the conversation, provider shape. */
export interface GeminiDialogueLine {
  readonly speakerId: SpeakerId;
  readonly text: string;
  /** Optional pronunciation guidance attached to this line. */
  readonly pronunciation?: readonly string[];
}

/** Whole-conversation request, provider shape. */
export interface GeminiMultiSpeakerRequest {
  readonly model: string;
  readonly dialogue: readonly GeminiDialogueLine[];
  readonly speakers: readonly GeminiVoiceConfig[];
  /** Natural-language style steering for the whole conversation. */
  readonly styleInstruction?: string;
  readonly sampleRate: 24000 | 48000;
}

// ---------------------------------------------------------------------------
// Provider-specific response shape (stays inside this module)
// ---------------------------------------------------------------------------

/** Turn-level alignment segment carved out of the returned audio stream. */
export interface GeminiTurnSegment {
  readonly turnId: string;
  readonly startMs: number;
  readonly endMs: number;
}

/** Whole-conversation response, provider shape. */
export interface GeminiMultiSpeakerResponse {
  readonly audio: AudioPayload;
  readonly turnSegments: readonly GeminiTurnSegment[];
  readonly model?: string;
  readonly usage?: {
    readonly inputTokens?: number;
    readonly outputTokens?: number;
    readonly audioSeconds?: number;
  };
}

/** Typed failure modes the adapter exposes to callers. */
export type GeminiAdapterError =
  | { kind: 'missing-credentials'; detail: string }
  | { kind: 'transport'; detail: string }
  | { kind: 'provider-rejected'; detail: string }
  | { kind: 'alignment-mismatch'; detail: string };

// ---------------------------------------------------------------------------
// Adapter interface
// ---------------------------------------------------------------------------

/**
 * Adapter interface for the Gemini-style multi-speaker TTS provider.
 * `synthesizeDialogue` is REQUIRED here (narrowed from the optional port
 * method) because whole-conversation synthesis is this provider's native
 * mode; `synthesizeTurn` remains available for single-turn regeneration of
 * the smallest failed unit.
 */
export interface GeminiMultiSpeakerTtsAdapter extends SpeechProvider {
  readonly id: 'gemini-multi-speaker-tts';
  readonly kind: 'remote-multi-speaker';

  /** Pure: neutral compiler requests -> provider request shape. */
  buildMultiSpeakerRequest(
    dialogue: readonly SpeechTurnRequest[],
    voices: ReadonlyMap<SpeakerId, SpeakerVoiceProfile>,
    styleInstruction?: string,
  ): GeminiMultiSpeakerRequest;

  /** Pure: provider response -> neutral per-turn results, in order. */
  parseMultiSpeakerResponse(
    response: GeminiMultiSpeakerResponse,
    dialogue: readonly SpeechTurnRequest[],
  ): readonly SpeechTurnResult[];

  synthesizeDialogue(
    dialogue: readonly SpeechTurnRequest[],
    voices: ReadonlyMap<SpeakerId, SpeakerVoiceProfile>,
    styleInstruction?: string,
  ): Promise<readonly SpeechTurnResult[]>;

  synthesizeTurn(
    request: SpeechTurnRequest,
    voices: ReadonlyMap<SpeakerId, SpeakerVoiceProfile>,
  ): Promise<SpeechTurnResult>;

  asError(error: unknown): GeminiAdapterError;
}
