/**
 * Illustration provider factory (WFLX-W3) — provider selection.
 *
 * Env-flag override, mirroring the W2 speech factory:
 *
 *   WFLX_VISUAL_ILLUSTRATION_PROVIDER = 'offline' (default) | 'image-model'
 *
 * The default is ALWAYS the offline deterministic ink adapter: the lab's
 * canonical path needs no network and no credentials. The image-model
 * adapter is opt-in and requires runtime-injected configuration.
 */

import type { IllustrationProvider } from './port';
import { DeterministicInkIllustration } from './deterministic-ink';
import { RemoteImageModelIllustration } from './image-model';

export const ILLUSTRATION_PROVIDER_ENV_FLAG = 'WFLX_VISUAL_ILLUSTRATION_PROVIDER';

export type IllustrationProviderChoice = 'offline' | 'image-model';

export interface SelectIllustrationProviderOptions {
  /** Explicit choice; overrides the env flag. Default 'offline'. */
  readonly provider?: IllustrationProviderChoice;
  /** Deterministic seed for the offline adapter. */
  readonly seed?: string;
  /** Env source; defaults to process.env (injectable for tests). */
  readonly env?: NodeJS.ProcessEnv;
}

export interface SelectedIllustrationProvider {
  readonly provider: IllustrationProvider;
  readonly choice: IllustrationProviderChoice;
}

export function selectIllustrationProvider(
  options: SelectIllustrationProviderOptions = {},
): SelectedIllustrationProvider {
  const env = options.env ?? process.env;
  const choice: IllustrationProviderChoice =
    options.provider ??
    ((env[ILLUSTRATION_PROVIDER_ENV_FLAG] as IllustrationProviderChoice | undefined) ??
      'offline');

  if (choice === 'image-model') {
    return { provider: new RemoteImageModelIllustration({}, env), choice };
  }
  return {
    provider: new DeterministicInkIllustration({
      ...(options.seed !== undefined ? { seed: options.seed } : {}),
    }),
    choice: 'offline',
  };
}
