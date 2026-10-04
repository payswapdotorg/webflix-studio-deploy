/**
 * Generative video provider factory (WFLX-P2, Deliverable C) — selection.
 *
 *   WFLX_VIDEO_PROVIDER = 'offline' (default) | 'live-zai'
 *
 * The default is ALWAYS the offline deterministic stand-in; the live z-ai
 * video adapter is opt-in for the REAL generative execution arm (EV-022).
 */

import type { VideoGenerativeProvider } from './generative-port';
import { OfflineGenerativeVideo } from './offline-generative';
import { ZaiLiveVideoGenerative } from './zai-live';

export const VIDEO_GENERATIVE_PROVIDER_ENV_FLAG = 'WFLX_VIDEO_PROVIDER';

export type VideoGenerativeProviderChoice = 'offline' | 'live-zai';

export interface SelectVideoGenerativeOptions {
  /** Explicit choice; overrides the env flag. Default 'offline'. */
  readonly provider?: VideoGenerativeProviderChoice;
  /** Env source; defaults to process.env (injectable for tests). */
  readonly env?: NodeJS.ProcessEnv;
}

export interface SelectedVideoGenerative {
  readonly provider: VideoGenerativeProvider;
  readonly choice: VideoGenerativeProviderChoice;
}

export function selectVideoGenerativeProvider(
  options: SelectVideoGenerativeOptions = {},
): SelectedVideoGenerative {
  const env = options.env ?? process.env;
  const choice: VideoGenerativeProviderChoice =
    options.provider ??
    ((env[VIDEO_GENERATIVE_PROVIDER_ENV_FLAG] as VideoGenerativeProviderChoice | undefined) ??
      'offline');

  if (choice === 'live-zai') {
    return { provider: new ZaiLiveVideoGenerative({}, env), choice };
  }
  return { provider: new OfflineGenerativeVideo(), choice: 'offline' };
}
