/**
 * Audio pipeline (WFLX-W2, Stage 2) — speaker personas.
 *
 * Plan `speakerRole` values (host-a / host-b / guest / narrator) map onto lab
 * personas with display names, role bias and voice profiles (DESIGN.md §16.2
 * item 7). W2 never changes plan speaker assignment. Display names are LAB
 * personas, not product voice names (§3.3). Voice descriptors are
 * language-conditioned (§11): persona identity is preserved by role, not by
 * literal voice name.
 */

import type { OverviewPlan, SpeakerRole } from '../../contracts';
import type { SpeakerPersona, SpeakerStance } from './types';

/** Lab persona display names by speaker role (deterministic, seed-free). */
const DISPLAY_NAMES: Readonly<Record<SpeakerRole, string>> = {
  'host-a': 'Ava',
  'host-b': 'Ben',
  guest: 'Guest',
  narrator: 'Narrator',
};

/** Role bias: the guide hosts framing/questions, the analyst explanations. */
const ROLE_BIAS: Readonly<Record<SpeakerRole, 'guide' | 'analyst'>> = {
  'host-a': 'guide',
  'host-b': 'analyst',
  guest: 'analyst',
  narrator: 'analyst',
};

/** Neutral voice descriptors by role (lab-local, provider-neutral). */
const VOICE_BY_ROLE: Readonly<Record<SpeakerRole, string>> = {
  'host-a': 'female-warm-analytical',
  'host-b': 'male-grounded-analytical',
  guest: 'neutral-visitor',
  narrator: 'neutral-narrator',
};

const VOICE_RATE: Readonly<Record<SpeakerRole, number>> = {
  'host-a': 1.0,
  'host-b': 0.98,
  guest: 1.0,
  narrator: 0.96,
};

const VOICE_PITCH: Readonly<Record<SpeakerRole, number>> = {
  'host-a': 1.0,
  'host-b': 0.94,
  guest: 1.0,
  narrator: 0.98,
};

/**
 * Derive the personas for a plan. `stancesByRole` carries the debate stance
 * aggregated from turn briefs (HYPOTHESIS-grade derivation, DESIGN.md §16.4
 * item 1); outside debate every stance is 'neutral'.
 */
export function derivePersonas(
  plan: OverviewPlan,
  stancesByRole: ReadonlyMap<SpeakerRole, SpeakerStance>,
): readonly SpeakerPersona[] {
  const roles = new Set<SpeakerRole>(plan.audioTurns.map((turn) => turn.speakerRole));
  const personas: SpeakerPersona[] = [];
  for (const role of roles) {
    personas.push({
      speakerRole: role,
      displayName: DISPLAY_NAMES[role],
      roleBias: ROLE_BIAS[role],
      stance: stancesByRole.get(role) ?? 'neutral',
      voice: {
        // Language-conditioned voice descriptor (DESIGN.md §11): same role,
        // same persona identity, per-language voice switching.
        voice: `${VOICE_BY_ROLE[role]}/${plan.language.toLowerCase()}`,
        rate: VOICE_RATE[role],
        pitch: VOICE_PITCH[role],
        volume: 1.0,
        styleTags: [plan.mode, ROLE_BIAS[role], plan.style.pacing ?? 'measured'],
      },
    });
  }
  // Deterministic order: plan order of first appearance.
  const order = plan.audioTurns.map((turn) => turn.speakerRole);
  personas.sort((a, b) => order.indexOf(a.speakerRole) - order.indexOf(b.speakerRole));
  return personas;
}
