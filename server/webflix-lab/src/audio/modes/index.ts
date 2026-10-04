/**
 * Audio pipeline (WFLX-W2, Stage 2) — mode profile registry.
 */

import type { AudioOverviewMode } from '../../contracts';
import { BRIEF_PROFILE } from './brief';
import { CRITIQUE_PROFILE } from './critique';
import { DEBATE_PROFILE } from './debate';
import { DEEP_DIVE_PROFILE } from './deep-dive';
import type { ModeProfile } from './common';

const PROFILES: Readonly<Record<AudioOverviewMode, ModeProfile>> = {
  'deep-dive': DEEP_DIVE_PROFILE,
  brief: BRIEF_PROFILE,
  critique: CRITIQUE_PROFILE,
  debate: DEBATE_PROFILE,
};

/** Look up the mode profile for an audio overview mode. */
export function modeProfileFor(mode: AudioOverviewMode): ModeProfile {
  return PROFILES[mode];
}

export type { ModeProfile } from './common';
