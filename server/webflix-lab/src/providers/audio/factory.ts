/**
 * Speech provider (WFLX-W2, Stage 2) — provider selection factory.
 *
 * The compile API selects the speech provider by option, with env-flag
 * overrides for the optional real adapters:
 *
 *   WFLX_AUDIO_SPEECH_PROVIDER = 'offline' (default) | 'gemini'
 *   WFLX_TTS_PROVIDER          = 'live-zai'   (WFLX-P1, EV-016 — real
 *                                            production TTS via the
 *                                            server-side z-ai-web-dev-sdk;
 *                                            any other value is ignored by
 *                                            this flag and falls through)
 *
 * The default is ALWAYS the offline deterministic adapter: the lab's
 * canonical path needs no network and no credentials. The Gemini adapter is
 * opt-in and requires GEMINI_API_KEY in the environment (injected by TL-side
 * runtime wiring; never committed). The ZAI live adapter is opt-in through
 * its own flag; it carries no committed credentials either (SDK ambient
 * auth) and its output is honestly stochastic (LAB-06 discipline) — never a
 * byte-determinism surface.
 */

import type { SpeechProvider } from './port';
import { DeterministicOfflineTtsAdapter } from './deterministic-offline';
import { GeminiMultiSpeakerTts } from './gemini-multi-speaker-adapter';
import { ZaiLiveTts } from './zai-live';

export const SPEECH_PROVIDER_ENV_FLAG = 'WFLX_AUDIO_SPEECH_PROVIDER';
/** WFLX-P1 (EV-016): activation flag for the ZAI live TTS adapter. */
export const TTS_PROVIDER_ENV_FLAG = 'WFLX_TTS_PROVIDER';
export const LIVE_ZAI_CHOICE = 'live-zai' as const;

export type SpeechProviderChoice = 'offline' | 'gemini' | 'live-zai';

export interface SelectSpeechProviderOptions {
  /** Explicit choice; overrides the env flags. Default 'offline'. */
  readonly provider?: SpeechProviderChoice;
  /** Deterministic seed for the offline adapter (required for determinism). */
  readonly seed?: string | number;
  /** Env source; defaults to process.env (injectable for tests). */
  readonly env?: NodeJS.ProcessEnv;
}

export interface SelectedSpeechProvider {
  readonly provider: SpeechProvider;
  readonly choice: SpeechProviderChoice;
}

export function selectSpeechProvider(
  options: SelectSpeechProviderOptions = {},
): SelectedSpeechProvider {
  const env = options.env ?? process.env;

  // WFLX-P1 (EV-016): the live-zai activation flag is checked FIRST and only
  // matches its single documented value — any other value falls through to
  // the pre-existing logic, so the flag cannot disturb the offline default.
  if (
    options.provider === LIVE_ZAI_CHOICE ||
    env[TTS_PROVIDER_ENV_FLAG] === LIVE_ZAI_CHOICE
  ) {
    // No committed credentials: the SDK authenticates from the ambient
    // runtime environment (operator/TL-side wiring). Public config only.
    return { provider: new ZaiLiveTts({}, env), choice: LIVE_ZAI_CHOICE };
  }

  const choice: SpeechProviderChoice =
    options.provider ??
    ((env[SPEECH_PROVIDER_ENV_FLAG] as SpeechProviderChoice | undefined) ?? 'offline');

  if (choice === 'gemini') {
    // Credentials are read from env inside the adapter (name declared via
    // requiredCredentialKeys; values never logged or committed).
    return { provider: new GeminiMultiSpeakerTts({}, env), choice };
  }
  if (choice === LIVE_ZAI_CHOICE) {
    return { provider: new ZaiLiveTts({}, env), choice };
  }
  return {
    provider: new DeterministicOfflineTtsAdapter({
      seed: options.seed !== undefined ? String(options.seed) : undefined,
    }),
    choice: 'offline',
  };
}
