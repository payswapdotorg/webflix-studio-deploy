/**
 * Audio pipeline (WFLX-W2, Stage 2) — Critique mode profile.
 *
 * DOCUMENTED: Critique is one of the four Gemini Notebook audio formats
 * (tests/audio/mode-semantics.md D-01). Lab design targets (H-A-02): every
 * topic cluster restructured into evaluation (assessment / limitation /
 * implication) and a verdict-shaped closing; the register below realizes
 * evaluative language. Plan-level weakness/gap flags do not exist yet
 * (DESIGN.md §16.4 item 1 HANDOFF) — enriched-tag derivation rests on brief
 * keywords and is HYPOTHESIS-grade.
 */

import type { ModeProfile } from './common';

export const CRITIQUE_PROFILE: ModeProfile = {
  mode: 'critique',
  rate: { wordsPerSecond: 2.6, floorMultiplier: 0.85, ceilMultiplier: 1.15 },
  gapScale: 1.0,
  enrichedRules: [
    // Evaluation family (maps to explanation per §16.2 item 5).
    { tag: 'assessment', purpose: 'explanation', pattern: /\bassess|what holds|holds up|evaluate\b/i },
    { tag: 'limitation', purpose: 'explanation', pattern: /\blimitation|weakness|weak spot|gap|missing|not address\b/i },
    // Verdict closing (maps to conclusion).
    { tag: 'verdict', purpose: 'conclusion', pattern: /\bverdict|judgment|weigh\b/i },
    // Conversational enrichment.
    { tag: 'acknowledgement', purpose: 'interjection', pattern: /\backnowledge|backchannel|affirm\b/i },
  ],
  stanceRules: [],
  surfaceOverlay: {
    openers: {
      statement: [
        "Let's stress-test that:",
        'How does that hold up?',
        'Evaluating this:',
        'Under scrutiny:',
      ],
      framing: ["We're here to stress-test this source.", 'Our job: poke at this.'],
      conclusion: ['So, the verdict:', 'Weighing it all:'],
    },
    closers: {
      statement: ['That much holds.', 'That stands up.', 'That is where it wobbles.'],
      conclusion: ['That is the verdict.'],
    },
    questionTails: [
      'does the evidence actually carry that?',
      'is that support solid?',
      'where is the weak point there?',
    ],
    evidenceIntros: ['Checking the source:', 'The text itself says:'],
  },
  qa: {
    expectedEnriched: [
      { tag: 'assessment', minTurns: 6 },
      { tag: 'limitation', minTurns: 6 },
      { tag: 'verdict', minTurns: 6 },
    ],
    discouragedPurposes: [],
  },
};
