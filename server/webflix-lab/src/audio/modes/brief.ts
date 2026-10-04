/**
 * Audio pipeline (WFLX-W2, Stage 2) — Brief mode profile.
 *
 * C-10 (v2 contract wave, ruling 2026-09-29; EV-009 LAB-02): the real Brief
 * is a SINGLE narrator with enumerated structure — First/Second/…/Finally,
 * 93.92 s single-voice (OBSERVED on the same source vs our v1 fixed 10-turn
 * two-speaker dialog at 120 s) — the strongest product-truth delta in the
 * register. Lab reproduction (REPRODUCED at the structure level; fixture-only
 * success is not product parity, AGENTS.md):
 *   - monologic skeleton (Director): 1 speaker, every turn SpeakerRole
 *     'narrator' — narrator framing, ONE explanation turn per topic beat,
 *     narrator conclusion;
 *   - EnumerationSpine (modes/common.ts): First/…/Finally openers selected
 *     by POSITION among the spine (statement) turns — never a seeded pick;
 *   - dialogic surfaces REMOVED (questionTails / acknowledgePrefixes empty)
 *     and conversational prefixes suppressed in the realizer for monologic
 *     modes — a single narrator asks no questions and acknowledges no
 *     co-host;
 *   - narrator sign-on ('Here is the brief:') / sign-off ('That is the
 *     brief.');
 *   - rate/gap UNCHANGED from v1 (dense profile 2.9 wps / gapScale 0.5).
 *
 * Duration-policy scope note (H-A-05): the product's ~120 s -> ~94 s Brief
 * delta comes from TURN-COUNT REDUCTION (the v1 10-turn two-speaker dialog
 * becomes an enumerated single-voice skeleton), NOT a velocity hack — the
 * rate model and gap scale stay at their v1 values and the over-budget
 * ladder still forbids speeding up to fit mandatory anchors.
 *
 * DOCUMENTED: Brief is one of the four Gemini Notebook audio formats
 * (tests/audio/mode-semantics.md D-01); exact Brief length semantics remain
 * UNRESOLVED (mode-semantics.md U-01). Lab design targets (H-A-01): compact
 * headline register, denser pacing, shorter gaps, no exploration agenda, no
 * examples unless plan-essential.
 */

import type { ModeProfile } from './common';

export const BRIEF_PROFILE: ModeProfile = {
  mode: 'brief',
  // C-10: single-voice mode BY DESIGN (see the module docblock).
  monologic: true,
  // C-10: the enumeration spine — First/…/Finally by POSITION among the
  // statement turns (never a seeded pick).
  enumeration: {
    families: ['statement'],
    ordinalOpeners: [
      'First,',
      'Second,',
      'Third,',
      'Fourth,',
      'Fifth,',
      'Sixth,',
      'Seventh,',
      'Eighth,',
      'Ninth,',
      'Tenth,',
    ],
    finalOpener: 'Finally,',
  },
  // Brief is allowed to sound denser (DESIGN.md §5.2 note on the per-mode floor).
  // UNCHANGED by C-10 — the product duration delta is turn-count reduction,
  // not velocity (H-A-05 scope note above).
  rate: { wordsPerSecond: 2.9, floorMultiplier: 0.85, ceilMultiplier: 1.18 },
  // Gaps shorter (DESIGN.md §4.2). UNCHANGED by C-10.
  gapScale: 0.5,
  enrichedRules: [
    { tag: 'takeaway', purpose: 'conclusion', pattern: /\btakeaway|one thing to remember\b/i },
    { tag: 'acknowledgement', purpose: 'interjection', pattern: /\backnowledge|backchannel|affirm\b/i },
  ],
  stanceRules: [],
  surfaceOverlay: {
    openers: {
      // C-10 narrator sign-on (single voice; no host intro).
      framing: ['Here is the brief:'],
      // Spine statement turns take POSITION-based enumeration openers
      // (see `enumeration`); no seeded statement openers remain in the
      // monologic register.
      statement: [],
      // The narrator conclusion lands on the sign-off closer, not on a
      // seeded conclusion opener.
      conclusion: [],
    },
    closers: {
      statement: [],
      // C-10 narrator sign-off.
      conclusion: ['That is the brief.'],
    },
    // C-10: dialogic surfaces REMOVED — a single narrator asks no questions
    // and acknowledges no co-host (a plan-level question/interjection turn
    // degrades honestly in the realizer and is flagged by QA below).
    questionTails: [],
    acknowledgePrefixes: [],
  },
  qa: {
    expectedEnriched: [],
    // H-A-01 + C-10 (EV-009 LAB-02): no agenda, no connection tissue,
    // examples only if plan-essential; DIALOGIC purposes (question /
    // interjection — acknowledgement is the enriched-tag view of
    // interjection) are discouraged in the monologic brief.
    discouragedPurposes: [
      { purpose: 'connection', severity: 'warning', note: 'brief plans should not carry connection turns (H-A-01)' },
      { purpose: 'example', severity: 'info', note: 'examples in brief should be plan-essential only (H-A-01)' },
      { purpose: 'question', severity: 'warning', note: 'the brief is a single-narrator enumerated overview (C-10, EV-009 LAB-02): question turns are dialogic tissue' },
      { purpose: 'interjection', severity: 'warning', note: 'the brief is a single-narrator enumerated overview (C-10, EV-009 LAB-02): interjection/acknowledgement backchannels are dialogic tissue' },
    ],
  },
};
