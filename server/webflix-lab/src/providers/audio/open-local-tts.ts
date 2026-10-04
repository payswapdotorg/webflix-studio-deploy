/**
 * Open/local TTS adapter — INTERFACE ONLY (Stage 1).
 *
 * Shapes the adapter boundary for open-weight or locally-hosted single-speaker
 * TTS engines with voice conditioning, e.g. a Chatterbox-style runtime:
 * one request = one speaker's text, with optional reference-audio voice
 * conditioning and style parameters. Multi-speaker conversations are built
 * by issuing one call per turn and stitching results in the mixing layer.
 *
 * DESIGN NOTES (DOCUMENTED, from public project materials collected in
 * docs/notebooklm-overviews-research.md):
 * - Chatterbox Multilingual (MIT) supports multilingual TTS with voice
 *   conditioning and expressive style parameters (exaggeration, CFG weight).
 * - Such engines are candidate open/local evaluation paths for the lab.
 *
 * IMPLEMENTATION RULES (binding):
 * - Implementation lands in Stage 2 as a THIN adapter over the engine's HTTP
 *   or process interface; endpoint/model injected via options
 *  (self-hosted runtimes need no credentials at all).
 * - The request/response structs in this file stay inside this module.
 * - Pure mapping helpers are exposed for offline unit testing.
 * - No network access is required by the lab's canonical test path; the
 *   offline deterministic adapter (separate file, Stage 2) covers
 *   credential-free end-to-end testing.
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

/**
 * Options for a local/open TTS runtime.
 * `endpoint` points at a self-hosted server or local process bridge.
 */
export interface OpenLocalTtsOptions extends SpeechProviderOptions {
  /** Engine identifier, e.g. 'chatterbox-multilingual'. */
  readonly engine?: string;
  readonly sampleRate?: number;
}

// ---------------------------------------------------------------------------
// Provider-specific request shape (stays inside this module)
// ---------------------------------------------------------------------------

/**
 * Voice conditioning for one speaker. Either a named/built-in voice or a
 * reference audio sample; never a credential.
 */
export type OpenLocalVoiceConditioning =
  | { readonly kind: 'named'; readonly voiceName: string }
  | { readonly kind: 'reference-audio'; readonly wav: Uint8Array; readonly sampleRate: number };

/** Expressive style parameters (Chatterbox-shaped; ignored by engines that do not support them). */
export interface OpenLocalStyleParams {
  /** Emotion intensity, 0..1. */
  readonly exaggeration?: number;
  /** Pace/phoneme-adherence CFG weight. */
  readonly cfgWeight?: number;
  readonly temperature?: number;
}

/** Single-speaker request, provider shape. */
export interface OpenLocalSingleSpeakerRequest {
  readonly text: string;
  readonly conditioning: OpenLocalVoiceConditioning;
  readonly style: OpenLocalStyleParams;
  readonly languageTag?: string;
  /** Seed where the engine supports seeded sampling. */
  readonly seed?: number;
}

/** Single-speaker response, provider shape. */
export interface OpenLocalSingleSpeakerResponse {
  readonly audio: AudioPayload;
}

/** Typed failure modes the adapter exposes to callers. */
export type OpenLocalAdapterError =
  | { kind: 'engine-unreachable'; detail: string }
  | { kind: 'engine-error'; detail: string }
  | { kind: 'unsupported-voice-conditioning'; detail: string };

// ---------------------------------------------------------------------------
// Adapter interface
// ---------------------------------------------------------------------------

/**
 * Adapter interface for open/local single-speaker TTS engines.
 * `synthesizeTurn` is the primary path (one turn per call);
 * `synthesizeDialogue` is inherited as an ordered sequence of single-speaker
 * calls — there is no native multi-speaker mode, which is why
 * `capabilities().nativeMultiSpeaker === false`.
 */
export interface OpenLocalTtsAdapter extends SpeechProvider {
  readonly kind: 'remote-single-speaker';

  /** Pure: neutral voice profile -> provider conditioning. */
  buildVoiceConditioning(
    speakerId: SpeakerId,
    profile: SpeakerVoiceProfile,
  ): OpenLocalVoiceConditioning;

  /** Pure: neutral turn request + conditioning + style -> provider request. */
  buildSingleSpeakerRequest(
    request: SpeechTurnRequest,
    conditioning: OpenLocalVoiceConditioning,
    style: OpenLocalStyleParams,
  ): OpenLocalSingleSpeakerRequest;

  /** Pure: provider response -> neutral result. */
  parseSingleSpeakerResponse(
    response: OpenLocalSingleSpeakerResponse,
    request: SpeechTurnRequest,
  ): SpeechTurnResult;

  synthesizeTurn(
    request: SpeechTurnRequest,
    voices: ReadonlyMap<SpeakerId, SpeakerVoiceProfile>,
  ): Promise<SpeechTurnResult>;

  asError(error: unknown): OpenLocalAdapterError;
}
