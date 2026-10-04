/**
 * SpeechProvider port — the provider-neutral boundary between the audio
 * compiler (src/audio) and concrete TTS backends.
 *
 * Ownership: Worker 2 (src/providers/audio), per docs/work-items/tl2-work-order.md.
 *
 * Rules (binding):
 * - This port is provider-NEUTRAL. Provider-specific request/response
 *   structures live inside their adapter files, never here.
 * - The port consumes/produces neutral audio-side types only. Shared W1
 *   contracts (AudioTurn etc.) are referenced by the compiler layer; this
 *   port must stay usable with plain turn-shaped inputs so it can be tested
 *   without the full IR.
 * - Credentials are constructor-injected by TL-side runtime wiring. Adapters
 *   declare required keys via `requiredCredentialKeys()`. No credential-shaped
 *   strings may be committed in code, fixtures, logs, or artifacts.
 * - All implementations must be deterministic when given a seed; the offline
 *   deterministic adapter is the canonical test path (no network, no keys).
 */

// ---------------------------------------------------------------------------
// Speakers and voices
// ---------------------------------------------------------------------------

/** Identifies a speaker within a dialogue; matches the compiler's persona ids. */
export type SpeakerId = string;

/**
 * Provider-agnostic description of one speaker's voice.
 * Adapters map `voice` onto concrete voice identifiers (prebuilt names,
 * conditioning references, etc.) — the mapping lives inside the adapter.
 */
export interface SpeakerVoiceProfile {
  readonly speakerId: SpeakerId;
  /** Neutral voice descriptor, e.g. 'female-warm-analytical'. */
  readonly voice: string;
  /** Speaking rate multiplier, 1.0 = neutral. */
  readonly rate?: number;
  /** Pitch multiplier, 1.0 = neutral. */
  readonly pitch?: number;
  /** Volume multiplier, 1.0 = neutral. */
  readonly volume?: number;
  /** Descriptive style tags the adapter may translate into style control. */
  readonly styleTags?: readonly string[];
}

// ---------------------------------------------------------------------------
// Pronunciation
// ---------------------------------------------------------------------------

export type PronunciationRiskReason =
  | 'acronym'
  | 'mixed-case'
  | 'digits'
  | 'symbols'
  | 'long-token'
  | 'proper-noun'
  | 'other';

/** A risky token plus how it should be said. Produced by src/audio/qa. */
export interface PronunciationHint {
  readonly token: string;
  /** Plain-spoken substitution or phonetic respelling. */
  readonly say: string;
  readonly reason?: PronunciationRiskReason;
}

// ---------------------------------------------------------------------------
// Turn-level synthesis requests (neutral)
// ---------------------------------------------------------------------------

/** One line of prior dialogue, for providers that condition across turns. */
export interface SpeechDialogueLine {
  readonly speakerId: SpeakerId;
  readonly text: string;
}

/** Neutral request to synthesize exactly one dialogue turn. */
export interface SpeechTurnRequest {
  readonly turnId: string;
  readonly speakerId: SpeakerId;
  readonly text: string;
  /**
   * Prior dialogue lines (compact). Providers without cross-turn
   * conditioning ignore this; multi-speaker-native providers use it for
   * prosody continuity.
   */
  readonly precedingDialogue?: readonly SpeechDialogueLine[];
  /** Target duration from the timing engine; providers may treat as soft. */
  readonly targetSeconds?: number;
  /** Pronunciation hints derived by QA for this turn's text. */
  readonly pronunciationHints?: readonly PronunciationHint[];
}

// ---------------------------------------------------------------------------
// Audio payload (neutral)
// ---------------------------------------------------------------------------

export type AudioContainer = 'wav' | 'mp3' | 'ogg' | 'flac' | 'pcm-raw';

/** Raw audio bytes with format description. */
export interface AudioPayload {
  readonly data: Uint8Array;
  readonly container: AudioContainer;
  readonly sampleRate: number;
  readonly channels: number;
  readonly bitsPerSample: number;
}

// ---------------------------------------------------------------------------
// Results and issues
// ---------------------------------------------------------------------------

/** Neutral result for one turn. */
export interface SpeechTurnResult {
  readonly turnId: string;
  readonly audio: AudioPayload;
  readonly durationSeconds: number;
  /**
   * Echo of the voice parameters the provider actually used, for
   * speaker-consistency QA. Shape is provider-defined but must be stable
   * per (provider, speaker) for identical inputs.
   */
  readonly effectiveVoiceParams: Readonly<Record<string, unknown>>;
}

export interface SpeechSynthesisIssue {
  readonly code: string;
  readonly message: string;
  readonly turnId?: string;
}

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

export interface SpeechProviderCapabilities {
  /** True if one request can carry the whole multi-speaker dialogue. */
  readonly nativeMultiSpeaker: boolean;
  readonly maxSpeakers: number;
  /** True if each speaker can carry independent voice parameters. */
  readonly perSpeakerVoiceParams: boolean;
  /** True if pronunciation hints can be honored natively. */
  readonly supportsPronunciationHints: boolean;
  /** True if the provider conditions prosody on preceding dialogue. */
  readonly supportsCrossTurnConditioning: boolean;
  readonly containers: readonly AudioContainer[];
}

// ---------------------------------------------------------------------------
// Provider construction and interface
// ---------------------------------------------------------------------------

/** Opaque credential bag injected at runtime; never logged or committed. */
export type SpeechCredentialBag = Readonly<Record<string, string | undefined>>;

/** Common constructor options for all speech providers. */
export interface SpeechProviderOptions {
  readonly credentials?: SpeechCredentialBag;
  /** Override endpoint (self-hosted/local backends, proxies). */
  readonly endpoint?: string;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  /** Seed for any stochastic provider behavior; required for determinism. */
  readonly seed?: number;
}

/**
 * The SpeechProvider port. `synthesizeTurn` is the minimum contract;
 * `synthesizeDialogue` is implemented by providers that synthesize the full
 * conversation natively (better prosody, single round-trip).
 */
export interface SpeechProvider {
  readonly id: string;
  readonly kind: 'remote-multi-speaker' | 'remote-single-speaker' | 'offline-deterministic';
  /**
   * Optional PUBLIC model identity (e.g. service/model id) for artifact
   * provenance — provider-neutral metadata, never a secret. Absent on
   * providers without a meaningful external model id (the offline adapter).
   * WFLX-P1 (EV-016): recorded in GeneratedArtifact.providers[speech].model.
   */
  readonly modelId?: string;

  capabilities(): SpeechProviderCapabilities;

  /** Env/config keys the adapter needs; empty for offline adapters. */
  requiredCredentialKeys(): readonly string[];

  /**
   * Synthesize one turn. Throws on credential absence, transport failure, or
   * policy violation (never silently degrades audio).
   */
  synthesizeTurn(
    request: SpeechTurnRequest,
    voices: ReadonlyMap<SpeakerId, SpeakerVoiceProfile>,
  ): Promise<SpeechTurnResult>;

  /**
   * Optional native multi-speaker path: synthesize an ordered dialogue in
   * one provider call. Implementations return one result per input turn,
   * in order.
   */
  synthesizeDialogue?(
    dialogue: readonly SpeechTurnRequest[],
    voices: ReadonlyMap<SpeakerId, SpeakerVoiceProfile>,
  ): Promise<readonly SpeechTurnResult[]>;

  /** Optional liveness/credential probe for TL-side wiring checks. */
  healthCheck?(): Promise<{ ok: boolean; detail?: string }>;

  /** Optional resource cleanup. */
  dispose?(): void;
}
