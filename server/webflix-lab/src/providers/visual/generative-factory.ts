/**
 * Generative visual provider factory (WFLX-P2, Deliverable C) — selection.
 *
 * Env-flag override (the P1 live-TTS pattern):
 *
 *   WFLX_VISUAL_PROVIDER = 'offline' (default) | 'live-zai'
 *
 * The default is ALWAYS the offline deterministic stand-in: the lab's
 * canonical cinematic path needs no network and no credentials. The live
 * z-ai adapter is opt-in for the REAL generative execution arm (EV-022).
 */

import type { VisualGenerativeProvider } from './generative-port';
import { OfflineGenerativeVisual } from './offline-generative';
import { ZaiLiveVisualGenerative } from './zai-live';

export const VISUAL_GENERATIVE_PROVIDER_ENV_FLAG = 'WFLX_VISUAL_PROVIDER';

export type VisualGenerativeProviderChoice = 'offline' | 'live-zai';

export interface SelectVisualGenerativeOptions {
  /** Explicit choice; overrides the env flag. Default 'offline'. */
  readonly provider?: VisualGenerativeProviderChoice;
  /** Env source; defaults to process.env (injectable for tests). */
  readonly env?: NodeJS.ProcessEnv;
}

export interface SelectedVisualGenerative {
  readonly provider: VisualGenerativeProvider;
  readonly choice: VisualGenerativeProviderChoice;
}

export function selectVisualGenerativeProvider(
  options: SelectVisualGenerativeOptions = {},
): SelectedVisualGenerative {
  const env = options.env ?? process.env;
  const choice: VisualGenerativeProviderChoice =
    options.provider ??
    ((env[VISUAL_GENERATIVE_PROVIDER_ENV_FLAG] as VisualGenerativeProviderChoice | undefined) ??
      'offline');

  if (choice === 'live-zai') {
    return { provider: new ZaiLiveVisualGenerative({}, env), choice };
  }
  return { provider: new OfflineGenerativeVisual(), choice: 'offline' };
}
