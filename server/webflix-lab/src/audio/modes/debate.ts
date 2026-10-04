/**
 * Audio pipeline (WFLX-W2, Stage 2) — Debate mode profile.
 *
 * DOCUMENTED: Debate is one of the four Gemini Notebook audio formats
 * (tests/audio/mode-semantics.md D-01). Lab design targets (H-A-03): hosts
 * hold opposing positions over contested claims with position / rebuttal /
 * cross-examination turns; uncontested claims are never artificially opposed
 * (grounding rule); a rebuttal must cite different claim ids than the
 * position it rebuts (rebuttal-by-restatement is a validation error).
 *
 * Stance derivation from brief wording is HYPOTHESIS-grade (DESIGN.md §16.4
 * item 1: no stance signal on beats/claims yet — HANDOFF to W1/TL).
 */

import type { ModeProfile } from './common';

export const DEBATE_PROFILE: ModeProfile = {
  mode: 'debate',
  rate: { wordsPerSecond: 2.7, floorMultiplier: 0.85, ceilMultiplier: 1.15 },
  gapScale: 0.9,
  enrichedRules: [
    // Argument family (maps to framing / clarification / question per §16.2 item 5).
    // NOTE: the neutral MOTION statement (framing without a side) is not a
    // position — 'motion' alone does not fire this rule.
    { tag: 'position_statement', purpose: 'framing', pattern: /\bposition\b|\bargue\b|\bcase for\b|\bcase against\b/i },
    { tag: 'rebuttal', purpose: 'clarification', pattern: /\brebut|counter|push back|respond to the other side\b/i },
    { tag: 'concession', purpose: 'clarification', pattern: /\bconcede|grant the point|give them\b/i },
    { tag: 'cross_examination', purpose: 'question', pattern: /\bcross-examine|cross examine|press|challenge\b/i },
    { tag: 'points_of_agreement', purpose: 'synthesis', pattern: /\bagree|points of agreement|common ground\b/i },
  ],
  stanceRules: [
    { stance: 'pro', pattern: /\bpro\b|\bin favor\b|\bfor the motion\b|\bcase for\b/i },
    { stance: 'con', pattern: /\bcon\b|\bagainst\b|\bopposed\b|\bcase against\b/i },
  ],
  surfaceOverlay: {
    openers: {
      statement: ['On our side of this:', 'The record here:', 'Look at what the source says:'],
      framing: ['The motion on the table:', 'Our position:', 'Here is where we stand:'],
      question: ['Press on that:', 'Cross-examining:', 'Hold on —'],
      clarification: ['I would push back:', 'Counterpoint:', 'Not so fast —'],
      conclusion: ['Weighing the evidence:', 'The balanced read:'],
      synthesis: ['Points of agreement first:', 'Where we both land:'],
    },
    closers: {
      statement: ['The evidence tilts our way.', 'That is our case.'],
      conclusion: ['The evidence, weighed.', 'That is the judgment.'],
    },
    questionTails: [
      'is that actually supported by the evidence?',
      'can you ground that claim?',
      'does the source really say that?',
    ],
    acknowledgePrefixes: ['Fair —', 'Alright —', 'Taking that head-on —'],
  },
  qa: {
    expectedEnriched: [
      { tag: 'position_statement', minTurns: 6 },
      { tag: 'rebuttal', minTurns: 6 },
      { tag: 'cross_examination', minTurns: 6 },
    ],
    discouragedPurposes: [],
  },
};
