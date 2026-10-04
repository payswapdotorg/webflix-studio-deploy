/**
 * Audio pipeline (WFLX-W2, Stage 2) — Deep Dive mode profile (baseline).
 *
 * DOCUMENTED: Deep Dive is one of the four Gemini Notebook audio formats
 * (tests/audio/mode-semantics.md D-01). Its editorial structure (which turns
 * exist) is plan-authoritative; this profile conditions realization register,
 * pacing and QA expectations. The product-level claim that Deep Dives are
 * exploratory two-host discussions stays HYPOTHESIS until EXP-A runs.
 */

import type { ModeProfile } from './common';

export const DEEP_DIVE_PROFILE: ModeProfile = {
  mode: 'deep-dive',
  rate: { wordsPerSecond: 2.6, floorMultiplier: 0.85, ceilMultiplier: 1.15 },
  gapScale: 1.0,
  enrichedRules: [
    // Structural enrichment (maps back to framing per §16.2 item 5).
    { tag: 'opening_hook', purpose: 'framing', pattern: /\bhook|open with|grab the listener\b/i },
    { tag: 'agenda', purpose: 'framing', pattern: /\bagenda|roadmap|lay out the plan\b/i },
    // Conversational enrichment.
    { tag: 'acknowledgement', purpose: 'interjection', pattern: /\backnowledge|backchannel|affirm\b/i },
    { tag: 'takeaway', purpose: 'conclusion', pattern: /\btakeaway|one thing to remember\b/i },
    { tag: 'recap', purpose: 'synthesis', pattern: /\brecap|so far\b/i },
  ],
  stanceRules: [],
  surfaceOverlay: {},
  qa: {
    expectedEnriched: [
      { tag: 'question', minTurns: 8 },
      { tag: 'example', minTurns: 12 },
      { tag: 'connection', minTurns: 12 },
    ],
    discouragedPurposes: [],
  },
};
