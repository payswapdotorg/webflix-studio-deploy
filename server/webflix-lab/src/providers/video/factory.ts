/**
 * Motion provider factory (WFLX-W3) — provider selection.
 *
 *   WFLX_VIDEO_MOTION_PROVIDER = 'offline' (default) | 'remote'
 *
 * The default is ALWAYS the offline deterministic motion planner (parametric
 * camera moves; no network, no keys). The remote video-model adapter is
 * opt-in and requires runtime-injected configuration.
 */

import type { MotionProvider } from './port';
import { DeterministicMotionProvider } from './deterministic-motion';
import { RemoteVideoModelMotion } from './remote-motion';

export const MOTION_PROVIDER_ENV_FLAG = 'WFLX_VIDEO_MOTION_PROVIDER';

export type MotionProviderChoice = 'offline' | 'remote';

export interface SelectMotionProviderOptions {
  /** Explicit choice; overrides the env flag. Default 'offline'. */
  readonly provider?: MotionProviderChoice;
  /** Env source; defaults to process.env (injectable for tests). */
  readonly env?: NodeJS.ProcessEnv;
}

export interface SelectedMotionProvider {
  readonly provider: MotionProvider;
  readonly choice: MotionProviderChoice;
}

export function selectMotionProvider(
  options: SelectMotionProviderOptions = {},
): SelectedMotionProvider {
  const env = options.env ?? process.env;
  const choice: MotionProviderChoice =
    options.provider ??
    ((env[MOTION_PROVIDER_ENV_FLAG] as MotionProviderChoice | undefined) ?? 'offline');

  if (choice === 'remote') {
    return { provider: new RemoteVideoModelMotion({}, env), choice };
  }
  return { provider: new DeterministicMotionProvider(), choice: 'offline' };
}
