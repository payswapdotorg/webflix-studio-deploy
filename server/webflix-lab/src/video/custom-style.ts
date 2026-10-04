/**
 * Video pipeline (WFLX-P2, Deliverable A) — the custom-style layer.
 *
 * Product behavior under reconstruction (parity-completion work order §1):
 * "visual-style selection; custom visual style". The real product lets the
 * user type a free-form style prompt that changes the look of the generated
 * video. This layer reconstructs that behavior DETERMINISTICALLY inside the
 * lab: a custom prompt derives a StyleBible variant from a base bible
 * (default: the canonical reference-ink grammar).
 *
 * Reconstruction boundaries (honest, binding):
 * - The prompt affects VISUAL GRAMMAR ONLY (palette accent family, mood
 *   notes in rules). It NEVER changes exact labels, grounding, claim
 *   coverage, scene structure or narration text — the documented Director
 *   prior (custom instructions affect style fields only) extended to the
 *   visual surface.
 * - Derived palette values are LAB POLICY (HYPOTHESIS-labeled in their
 *   evidence strings), not reference observations: each derived role's
 *   evidence string says so explicitly. The base grammar's OBSERVED
 *   evidence stays attached to the roles that are inherited unchanged.
 * - Deterministic: identical prompt -> identical StyleBible bytes. The
 *   prompt hashes into the id, so two different prompts never collide and
 *   the same prompt always resolves to the same bible (no registry state).
 *
 * NOT product parity evidence on its own (AGENTS.md): the behavior claim
 * ("a custom style prompt changes the rendered visual surface and nothing
 * else") is what EXP-E-REFRESH's custom-style arm measures (EV-019).
 */

import { fnv1a32 } from './rng';
import {
  REFERENCE_INK_STYLE_BIBLE,
  STYLE_BIBLE_VERSION,
  isStyleBible,
  type PaletteEvidence,
  type StyleBible,
} from './style-bible';

/** Accent families the custom layer can derive (lab policy, fixed order). */
export interface CustomAccentFamily {
  readonly key: string;
  readonly emphasis: string;
  readonly emphasisDeep: string;
  readonly emphasisSoft: string;
  readonly warning: string;
  readonly accentWarm: string;
  readonly accentGreen: string;
  readonly aiNode: string;
}

/**
 * Four accent families inside the reference grammar's saturation/lightness
 * envelope (same visual weight as the OBSERVED reference accents, hues
 * rotated). Values are LAB POLICY — derived, not observed.
 */
export const CUSTOM_ACCENT_FAMILIES: readonly CustomAccentFamily[] = [
  {
    key: 'reference-teal',
    emphasis: '#53dfcd',
    emphasisDeep: '#3b9f92',
    emphasisSoft: '#63979f',
    warning: '#9f3b61',
    accentWarm: '#9f613b',
    accentGreen: '#87df53',
    aiNode: '#8f6db8',
  },
  {
    key: 'amber-duotone',
    emphasis: '#e0b83d',
    emphasisDeep: '#a8842b',
    emphasisSoft: '#9f9463',
    warning: '#c04a3b',
    accentWarm: '#d9903b',
    accentGreen: '#a3c353',
    aiNode: '#b08f5a',
  },
  {
    key: 'violet-print',
    emphasis: '#a78bdf',
    emphasisDeep: '#7a63a8',
    emphasisSoft: '#83789f',
    warning: '#c95a86',
    accentWarm: '#c07a5a',
    accentGreen: '#8fc9a3',
    aiNode: '#d0a3e8',
  },
  {
    key: 'crimson-lab',
    emphasis: '#df5372',
    emphasisDeep: '#a83b52',
    emphasisSoft: '#9f6373',
    warning: '#df3b3b',
    accentWarm: '#df9f53',
    accentGreen: '#87b353',
    aiNode: '#8f6db8',
  },
];

/** Roles the custom layer derives (accent family); everything else inherits. */
const DERIVED_ROLES = [
  'emphasis',
  'emphasisDeep',
  'emphasisSoft',
  'warning',
  'accentWarm',
  'accentGreen',
  'aiNode',
] as const;

function derivedEvidence(role: string, familyKey: string, prompt: string): PaletteEvidence {
  return {
    value: '',
    evidence:
      `DERIVED (WFLX-P2 custom-style layer, LAB POLICY / HYPOTHESIS): role '${role}' from accent ` +
      `family '${familyKey}' selected by the user style prompt ` +
      `"${prompt.slice(0, 120)}" — not a reference observation.`,
  };
}

export interface CustomStyleOptions {
  /** Base bible to derive from; defaults to the canonical reference-ink grammar. */
  readonly base?: StyleBible;
}

/**
 * Derive a deterministic custom StyleBible from a user style prompt.
 *
 * Pure function of (prompt, base). The prompt selects one accent family by
 * stable hash and is recorded in the bible name, id, rules and every derived
 * role's evidence string — full provenance, no hidden state.
 */
export function customStyleBible(prompt: string, options: CustomStyleOptions = {}): StyleBible {
  const trimmed = prompt.replace(/\s+/g, ' ').trim();
  if (trimmed.length === 0) {
    throw new Error('customStyleBible: empty style prompt');
  }
  const base = options.base ?? REFERENCE_INK_STYLE_BIBLE;
  const hash = fnv1a32(trimmed);
  const family = CUSTOM_ACCENT_FAMILIES[hash % CUSTOM_ACCENT_FAMILIES.length] as CustomAccentFamily;

  const palette = { ...base.palette } as Record<string, PaletteEvidence>;
  for (const role of DERIVED_ROLES) {
    const value = family[role as keyof CustomAccentFamily] as string;
    palette[role] = {
      value,
      evidence: derivedEvidence(role, family.key, trimmed).evidence,
    };
  }

  const shortPrompt = trimmed.length > 80 ? `${trimmed.slice(0, 77)}...` : trimmed;
  const customRule =
    `Custom style from user prompt "${shortPrompt}": affects palette/mood only; ` +
    'exact labels, grounding, claim coverage, scene structure and narration stay prompt-independent.';

  const candidate: StyleBible = {
    ...base,
    styleBibleVersion: STYLE_BIBLE_VERSION,
    id: `style-bible--custom-${hash.toString(16).padStart(8, '0')}`,
    name: `Custom (${shortPrompt})`,
    palette: {
      background: palette.background as PaletteEvidence,
      backgroundDeep: palette.backgroundDeep as PaletteEvidence,
      surface: palette.surface as PaletteEvidence,
      surfaceAlt: palette.surfaceAlt as PaletteEvidence,
      paper: palette.paper as PaletteEvidence,
      paperAlt: palette.paperAlt as PaletteEvidence,
      ink: palette.ink as PaletteEvidence,
      inkMuted: palette.inkMuted as PaletteEvidence,
      emphasis: palette.emphasis as PaletteEvidence,
      emphasisDeep: palette.emphasisDeep as PaletteEvidence,
      emphasisSoft: palette.emphasisSoft as PaletteEvidence,
      warning: palette.warning as PaletteEvidence,
      accentWarm: palette.accentWarm as PaletteEvidence,
      accentGreen: palette.accentGreen as PaletteEvidence,
      aiNode: palette.aiNode as PaletteEvidence,
    },
    rules: [...base.rules, customRule],
    evidence: {
      ...base.evidence,
      note:
        `${base.evidence.note} Custom-style variant derived by the WFLX-P2 custom-style layer ` +
        `(accent family '${family.key}' keyed by the user prompt hash; derived roles are LAB ` +
        `POLICY, inherited roles keep their original evidence).`,
    },
  };

  if (!isStyleBible(candidate)) {
    // Guarded construction: the derivation must always satisfy the grammar.
    throw new Error(`customStyleBible: derived bible fails its guard for prompt "${shortPrompt}"`);
  }
  return candidate;
}
