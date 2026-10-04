# Audio Overview Pipeline — Dialogue Compiler Architecture (W2)

Status: DESIGN (Stage 1) — IMPLEMENTED (Stage 2). Interfaces and documents
only at Stage 1; Stage 2 implemented the pipeline per §16 (branch
`work/wflx-w2-stage2`; see src/audio/README.md for the module map,
tests/audio/ for the suite, artifacts/audio/ for benchmarks). Sections 3–5
and 15 are superseded by §16 where they conflict, exactly as repositioned
there: the plan's `audioTurns` are authoritative; W2 validates, realizes,
times, synthesizes, mixes and measures.

> **Post-freeze alignment (authoritative):** Worker 1's contract freeze exists
> on branch `work/wflx-w1-contracts` @ `78be437` (not yet merged to main at the
time of this addendum). Section 16 reconciles this design against those
> actual contract shapes and **supersedes** any conflicting statements in
> sections 3–5 and 15. Read section 16 before implementing.

Evidence labels in this document follow AGENTS.md:
OBSERVED / DOCUMENTED / HYPOTHESIS / REPRODUCED / UNRESOLVED.
Claims about the real Gemini Notebook product are labeled; claims about this lab
pipeline are design decisions and are stated as such.

## 1. Scope and ownership

Worker 2 owns the audio surface of the Overview Compiler:

```text
OverviewPlan (W1 contract)
      |
      v
DialogueGraph            <-- this design: turns as graph nodes
      |
      v
AudioTurn[]              (W1 contract, produced by W2 compiler)
      |
      v
SpeechProvider (port)    <-- src/providers/audio (W2)
      |
      v
TimingManifest + aligned audio
      |
      v
Mix / master             (ffmpeg if available, pure-TS WAV otherwise)
      |
      v
GeneratedArtifact + provenance sidecar (W1 contract)
      |
      v
Audio QA (deterministic metrics only)
```

Not owned here: `src/contracts/` (W1+TL), `src/source/`, `src/director/`, `src/video/`.
Contract change requests are raised as HANDOFF entries, never edited silently.

Binding rules honored by this design (from docs/tl2-overview-studio-handoff.md and
the W2 work order):

- Dialogue is a real conversation, not mechanical speaker alternation.
- Every factual turn is grounded by claim ids from the plan; no free-floating
  assertions.
- The compiler is deterministic and seeded.
- Provider-specific request/response structures stay inside adapters.
- No credentials in code, fixtures, artifacts, or git history.

## 2. Why a graph, not a script

A flat script cannot represent the properties the lab must test:

| Property needed | Flat script | DialogueGraph |
| --- | --- | --- |
| Turn responds to a specific earlier turn | no | `links.respondsTo` |
| Backchannel/acknowledgement structure | no | typed short turns |
| Mode-specific challenge/counter patterns | fragile | typed purposes per mode |
| Smallest regenerable unit | paragraph | turn node |
| Mutation locality (EXP-A-04) | unclear | evidence per node |

The graph keeps a **primary linear order** (the spoken sequence) plus typed
conversational links. The linear order is what ships; the links are what QA,
tests, and partial regeneration reason about.

## 3. Core data model — DialogueGraph

`DialogueGraph` is an audio-side intermediate representation owned by W2. It is
NOT a shared contract; the shared output contract remains `AudioTurn[]`
(frozen by W1).

```ts
// src/audio/dialogue/types.ts (planned, Stage 2)

interface DialogueGraph {
  meta: {
    planId: string;
    planHash: string;              // binds the graph to the exact plan input
    mode: 'deep-dive' | 'brief' | 'critique' | 'debate';
    language: string;              // BCP-47
    targetDurationSeconds: number;
    seed: number;                  // deterministic stochasticity source
  };
  speakers: SpeakerPersona[];      // exactly 2 for all current modes
  turns: DialogueTurn[];           // primary linear order = spoken order
}

interface DialogueTurn {
  id: string;                     // stable: derived from (planHash, mode, index)
  speaker: SpeakerId;             // references speakers[].id
  purpose: TurnPurpose;           // typed, always present (validated)
  evidence: ClaimRef[];            // claim ids (+ optional span ids) from the plan
  section: SectionId;             // opening | exploration:<topicId> | ... | closing
  style: TurnStyle;               // register, energy, pace, formality
  targetDurationSeconds: number;  // from the budget allocator
  estimatedWords: number;         // rate model applied to targetDuration
  links: {
    respondsTo?: string[];         // turn ids this turn answers
    acknowledges?: string[];      // backchannel targets
    interrupts?: string[];         // soft interjection targets (v1: no overlap audio)
  };
}
```

### 3.1 TurnPurpose taxonomy (v1)

Structural: `opening_hook`, `framing`, `agenda`, `transition`, `recap`,
`synthesis`, `closing`.

Conversational: `question`, `follow_up`, `acknowledgement` (short backchannel),
`reaction`, `interjection`.

Content: `explanation`, `example`, `evidence_citation`, `comparison`,
`definition`.

Mode-specific: `assessment` and `limitation` (Critique), `position_statement`,
`rebuttal`, `cross_examination`, `concession`, `verdict` (Critique/Debate).

Every turn carries exactly one purpose. Validation fails on unknown purposes —
the taxonomy is closed so QA and mode tests can reason structurally.

### 3.2 Grounding rule

A turn with any factual assertion must reference at least one claim id that
exists in the plan. Turns with zero evidence are restricted to a structural or
conversational purpose allowlist (`framing`, `question`, `acknowledgement`,
`transition`, `agenda`, `recap`, `closing`, `reaction`, `interjection`,
`synthesis`, `opening_hook`) and even there, questions and hooks should anchor
to a topic id. This is enforced by graph validation, not by convention.

### 3.3 Speaker model

```ts
interface SpeakerPersona {
  id: SpeakerId;                  // 'host-a' | 'host-b'
  displayName: string;            // e.g. 'Ava' / 'Ben' (lab personas, not product names)
  roleBias: 'guide' | 'analyst';  // default conversational stance
  voice: SpeakerVoiceProfile;     // src/providers/audio port type
  stance?: 'pro' | 'con' | 'neutral';  // Debate only
}
```

- Two hosts for every mode [DOCUMENTED: the product's Audio Overviews are
  two-host discussions — official NotebookLM/Gemini Notebook materials, see
  docs/notebooklm-overviews-research.md].
- Personas are stable within a plan and consistent across regenerations with
  the same seed (speaker consistency is a QA metric).
- Role bias is a *bias*, not a hard rule: the guide hosts most framing and
  questions; the analyst hosts most explanations and examples; both may host
  any purpose when the turn-taking engine decides otherwise (seeded).
- Debate assigns stances; Critique may temporarily adopt an evaluative stance
  on both sides without persistent pro/con personas.

### 3.4 Turn-taking rules (no mechanical alternation)

The turn-taking engine assigns speakers and inserts conversational tissue. It
is a deterministic function of (plan, mode, seed) — never a fixed parity walk.

Rules (v1):

1. **Question ownership**: a `question` or `follow_up` is normally asked by the
   host who did not own the preceding explanation (curiosity dynamic).
2. **Answer ownership**: the `explanation`/`example` that answers a question
   is normally hosted by the other speaker, or by the topic owner (see rule 3).
3. **Topic ownership**: each plan topic is assigned an owner persona
   (deterministic, seeded). That persona hosts the topic's lead explanation;
   the other hosts lead-ins and follow-ups. Ownership alternates across topics
   so neither host degenerates into a permanent lecturer.
4. **Same-speaker merges**: consecutive turns by one speaker are allowed
   (max 2 in a row) when the purposes form a natural unit
   (`explanation` + `example`, `position_statement` + `evidence_citation`).
5. **Backchannels**: short `acknowledgement` turns are inserted with
   mode-dependent probability (see §5) — seeded, so reproducible.
6. **Soft interruptions**: `interjection` turns may split a speaker's unit at
   a topic boundary; v1 renders them as separate sequential turns —
   overlapping audio is out of scope for v1 (documented limitation).
7. **No empty turns**: every turn has non-empty realized text at render time.

What "not mechanical alternation" means operationally (QA-checked):

- speaker turn-share is not forced to 50/50 (expected band 35–65%);
- the longest run of strict ABAB alternation is bounded;
- backchannels and question→answer pairs exist in every Deep Dive / Critique /
  Debate graph of sufficient length;
- same-speaker merges occur where purpose units justify them.

The product-level claim that real Audio Overviews sound like natural
conversation (interruptions, banter, acknowledgements) is HYPOTHESIS from
public materials until black-box EXP-A runs confirm it; see
tests/audio/mode-semantics.md.

## 4. Mode compilers — editorial structure

Modes are compiled from the SAME plan into DIFFERENT graph structures. This is
the lab's core hypothesis space (EXP-A-01/02/03). The structural differences
below are design targets for the lab implementation; their claim that the real
product behaves this way is HYPOTHESIS and each has a testable predicate plus
a product-level falsifier in tests/audio/mode-semantics.md.

> Post-freeze note (§16): mode-specific editorial STRUCTURE now materializes in
> the plan's `audioTurns` (Worker 1's Director). W2 mode compilers VALIDATE and
> REALIZE mode structure (text register, pacing, mode-aware checks); they do
> not invent or restructure the authoritative turn skeleton.

### 4.1 Deep Dive (baseline mode)

```text
opening:    opening_hook -> framing -> (agenda, if duration budget allows)
exploration (per plan topic, in plan order):
            lead_in question -> explanation -> (example)* -> (follow_up -> answer)?
            ... periodic connection turns linking to earlier topics ...
synthesis:  cross-topic connections + big picture
closing:    takeaway -> closing
```

- Coverage target: the full covered claim set from the plan.
- Examples, follow-ups and connections are the *flexible tissue* that the
  duration engine grows or shrinks.
- Agenda turn only when target duration exceeds a mode threshold (long-form).

### 4.2 Brief (C-10 monologic restructure, v2 contract wave)

```text
opening:    narrator framing sign-on (1 turn, no agenda, no host intro)
core:       ONE narrator explanation turn per topic beat (the single carrier
            voices every beat claim), enumerated First/Second/…/Finally —
            openers by POSITION among the spine, never a seeded pick
closing:    narrator conclusion + sign-off ('That is the brief.')
```

- C-10 (EV-009 LAB-02, OBSERVED 93.92 s single-voice enumerated Brief on
  the same source vs the v1 120 s 10-turn two-speaker dialog): the Brief
  skeleton is monologic — speakers 1, every turn SpeakerRole 'narrator'
  (v1 contracts enum; no contracts change for the role).
- Dialogic surfaces removed (questionTails / acknowledgePrefixes empty;
  conversational prefixes suppressed in monologic modes): a single narrator
  asks no questions and acknowledges no co-host. Narrator sign-on 'Here is
  the brief:' / sign-off 'That is the brief.'.
- Duration policy (H-A-05): the product's ~120 s → ~94 s Brief delta comes
  from TURN-COUNT REDUCTION (10-turn dialog → enumerated single-voice),
  NOT a velocity hack — rate (2.9 wps) and gap scale (0.5) are unchanged
  from v1 and the over-budget ladder still forbids speeding up to fit.
- Coverage: priority subset of claims (k chosen by budget), dropped claims
  are reported, never silently lost; every beat still voiced (H-A-01).
- QA: dialogic purposes (question / interjection) discouraged with notes
  citing C-10/LAB-02; the H-A-04 dialogic turn-taking predicates do not
  apply to the monologic skeleton (the metric reports the C-10 note;
  multi-speaker plans in a monologic mode are flagged as Director
  feedback).
- Structural signature vs Deep Dive: no `agenda`, no `example` (unless
  essential), no `connection`, no `question`, single voice, far lower turn
  count for the same plan.

### 4.3 Critique

```text
opening:    framing-as-evaluation ("we stress-test this source")
body (per topic cluster, same coverage order as Deep Dive):
            summary of claims -> assessment (what holds, with evidence)
            -> limitation (weakness/gap/assumption) -> implication
priority:   plan-flagged contested claims, gaps and assumptions come first
closing:    verdict turns (balanced judgment), not a summary
```

- Coverage: near-full like Deep Dive, but every cluster is restructured into
  the assessment pattern and includes `limitation` turns.
- Sources of limitations: plan gap/weakness/contested flags. If the plan flags
  nothing for a cluster, the honest move is an explicit "the source does not
  address X" turn — never an invented criticism.
- Structural signature vs Deep Dive: presence of `assessment`/`limitation`/
  `verdict` purposes; opening framing is evaluative; connections reduced.

### 4.4 Debate

```text
opening:    motion statement (from plan thesis / top contested claim)
            position_statement per host (pro/con)
body (per contested claim):
            position_statement -> evidence_citation
            -> rebuttal (counter-evidence) -> cross_examination question
            -> response -> concession where evidence is asymmetric
points_of_agreement: uncontested core facts stated jointly (never fabricated
            disagreement over uncontested claims)
closing:    judge-style synthesis, evidence-weighted; no artificial winner
            unless the evidence strongly favors one side
```

- Only claims the plan marks contested (or with genuinely opposing evidence)
  may be debated; uncontested claims go to `points_of_agreement`.
- Every debate turn is evidence-bound on BOTH sides; a rebuttal must cite
  different claim ids than the position it rebuts (rebuttal-by-restatement is
  a validation error).
- Structural signature vs Deep Dive: `position_statement`/`rebuttal`/
  `cross_examination`/`concession` purposes; host stance assignment; an
  argument graph per contested claim.

### 4.5 Mode comparison summary

| Property | Deep Dive | Brief | Critique | Debate |
| --- | --- | --- | --- | --- |
| Coverage | full covered set | top-k subset | near-full | contested set + agreed core |
| Opening | hook+framing(+agenda) | narrator sign-on | evaluative framing | motion + positions |
| Cluster shape | explain+example | enumerated single-voice statement per beat | assess+limit+imply | position/rebut/cross-examine |
| Questions | common | none (monologic, C-10) | moderate | cross-examination |
| Backchannels | moderate | none (monologic, C-10) | moderate | moderate |
| Closing | takeaway | takeaway + sign-off | verdict | judged synthesis |
| Examples | budget-permitting | essential-only | supporting | as evidence |

## 5. Duration engine and narration density (EXP-A-05)

Target duration is a first-class input. The engine allocates a budget, then
grows or compresses the graph to fit.

### 5.1 Budget model

```text
gaps_total   = estimated from gap policy (§6)
opening      = min(cap_open(mode), f(target))
closing      = min(cap_close(mode), g(target))
exploration  = target - opening - closing - gaps_total
per-topic    = exploration * emphasis_weight(topic) / sum(weights)
```

Speaking-rate model: words ≈ `rate(mode, style) * seconds`, baseline
2.4–2.8 words/s (~145–170 wpm). Per-turn `estimatedWords` derives from its
`targetDurationSeconds`; realized text is checked against the estimate.

### 5.2 Compression ladder (over-budget)

> Post-freeze note (§16): plan-level durations are authoritative and
> deep-validated (turn durations sum to target; coverage accounts for every
> claim). Claim/example DROPPING is Director authority, not W2's. The ladder
> below is repositioned by §16 to TEXT-DENSITY FITTING within each turn's
> authoritative target, plus over-budget flagging — never silent editorial cuts.

Applied in order, stopping when the budget fits:

1. drop `example` turns (non-essential);
2. drop `connection`/`recap` turns;
3. drop `follow_up`/`answer` pairs;
4. drop lowest-emphasis claims (never claims the plan marks critical);
5. shrink per-turn durations toward a per-mode floor ( Brief floor < Deep Dive
   floor — Brief is allowed to sound denser).

If the floor is reached and the plan still does not fit, the compiler emits an
`over-budget` QA issue with the uncovered claim list instead of silently
dropping grounding-relevant content. Coverage decisions belong to the Director
(W1); the audio layer backpressures rather than inventing its own editorial
cuts. This is a HANDOFF: OverviewPlan should carry (or the Director should
answer) a "max claims for duration T" query so trimming happens above the
audio layer.

### 5.3 Expansion ladder (under-budget)

1. add `follow_up`/`answer` pairs per topic;
2. add examples from plan evidence;
3. add `connection` turns across topics;
4. add `recap` and light banter (mode permitting);
5. widen gaps within policy bounds.

Density claim [HYPOTHESIS]: the real product compresses by reducing
information density per second (dropping material) rather than speaking
proportionally faster; the lab encodes the same preference. Product-level
falsifier: duration-shrunk real overviews retain identical claim counts while
speaking measurably faster.

## 6. Timing and alignment

Per-turn and gap policy (all parameters are lab tuning knobs, values initial):

| Boundary class | Gap (ms) | Rationale |
| --- | --- | --- |
| question -> answer | 80–150 | conversational urgency |
| within topic cluster | 150–300 | thinking pause |
| topic boundary | 300–600 | paragraph feel |
| section boundary | 400–900 | chapter feel |
| around backchannel | 60–120 | quick affirmations |

- `TimingManifest` maps every turn to `startMs`, `endMs`, `gapAfterMs`,
  `targetSeconds` vs `actualSeconds`, and cumulative totals.
- After speech synthesis, actual durations replace estimates; drift beyond
  tolerance raises a QA issue naming the turn (smallest regenerable unit).
- Pause distribution is a QA metric (EXP-differential: "pauses" checklist
  item from docs/experiments/protocol.md).
- The gap-class values are UNRESOLVED against the real product (no audio
  black-box baseline yet); they are lab defaults, explicitly tunable.

## 7. Speech providers (ports — see src/providers/audio/)

Stage 1 delivers the port definitions:

- `src/providers/audio/port.ts` — provider-neutral `SpeechProvider` port with
  per-speaker voice profiles, pronunciation hints, capabilities, and
  constructor-injected credentials.
- `src/providers/audio/gemini-multi-speaker.ts` — adapter interface shaped
  for a Gemini-style single-request multi-speaker TTS.
- `src/providers/audio/open-local-tts.ts` — adapter interface shaped for an
  open/local single-speaker TTS with voice conditioning (Chatterbox-style).

Stage 2 adds:

- `DeterministicOfflineTtsAdapter` — pure-TS WAV/silence generator with exact
  per-turn durations so the ENTIRE pipeline (compile → speak → time → mix →
  master → QA) runs without network or credentials. ffmpeg 7.1.5 is available
  in the lab environment (DOCUMENTED: verified via `command -v ffmpeg` at
  Stage 1 time) and is the preferred mastering path, with the pure-TS WAV
  path as fallback and cross-check.

Credential rules: adapters declare `requiredCredentialKeys()`; keys are
constructor-injected by TL-side runtime wiring; nothing credential-shaped is
committed (code, fixtures, artifacts, logs). Real provider dispatch is a later
TL-side stage — no API keys exist in this environment.

## 8. Mixing and mastering

1. Normalize every turn's payload to a common format (PCM 16-bit, 44.1 kHz,
   mono) — resample if needed.
2. Concatenate per `TimingManifest` including gap silence.
3. Loudness-normalize the final track (initial target: −16 LUFS integrated,
   −1.5 dBTP; podcast-typical defaults, UNRESOLVED vs the real product).
4. Emit final WAV (and MP3 via ffmpeg when available).
5. Emit a `GeneratedArtifact` provenance sidecar: plan hash, mode, language,
   seed, provider ids, turn count, duration, SHA-256 of the media, cost/latency
   (offline = zero provider cost, recorded honestly as such), and the timing
   manifest reference.

## 9. Audio QA (deterministic metrics only)

`src/audio/qa/` measures (no LLM self-assessment as evidence, binding):

1. `duration_vs_target` — total duration vs plan target (tolerance band).
2. `turn_duration_drift` — per-turn actual vs target.
3. `speaker_consistency` — per-speaker voice params identical across turns;
   same-seed regeneration yields identical manifests.
4. `pause_distribution` — gap stats per boundary class vs policy.
5. `groundedness` — every factual turn's claim ids exist in the plan;
   evidence-bearing turn ratio.
6. `coverage` — claims covered vs plan covered set (mode-dependent target);
   dropped-claim report for Brief.
7. `turn_taking_naturalness` — parity band, alternation-run bound, backchannel
   and question-answer presence (structural, per §3.4).
8. `pronunciation_risk` — unusual tokens flagged (acronyms, mixed case,
   digits, symbols, long technical tokens) for hint generation.
9. `loudness` — measured LUFS/true-peak of the final track vs mastering
   target (when a loudness-measuring path is available; otherwise format-level
   checks only).
10. `defect_scan` — zero-length turns, unexpected long silences, clipped
    samples (basic), container integrity.

QA emits a typed `AudioQaReport` with issue codes and the smallest
regenerable unit (turn id) per issue, feeding the lab's
"regenerate the smallest failed unit" rule.

## 10. Determinism and seeds

- All stochastic choices (topic ownership, backchannel insertion, gap
  jitter within class, tie-breaks) draw from a seeded PRNG keyed by
  `(seed, planHash, mode, language, targetDurationSeconds)`.
- Same inputs ⇒ identical `DialogueGraph`, identical realized `AudioTurn[]`
  text, identical timing manifest, and (offline provider) byte-identical WAV.
- Regeneration stability across runs is itself a QA-checked property
  (EXP-A analog of EXP-V-08).

## 11. Language behavior (EXP-A-06)

- The graph structure (purposes, ordering, coverage, links) is
  language-invariant; surface realization (templates, discourse markers) is
  localized.
- Claim ids are the cross-language anchor: coverage equality across languages
  is testable structurally.
- Voices switch per language via `SpeakerVoiceProfile` — persona identity is
  preserved by role, not by literal voice name.
- HYPOTHESIS (product): the real product preserves claim selection/order
  across languages while re-localizing expression. Lab test asserts the lab
  property; product-level confirmation needs EXP-A-06 black-box runs.

## 12. Custom prompt behavior (prompt mutations)

- Custom prompts reach the audio layer only through plan fields (style,
  emphasis boosts, banned/required terms, audience) — the Director (W1)
  owns prompt interpretation.
- The audio compiler threads plan style fields into `TurnStyle` and text
  realization; it does not re-decide coverage.
- HYPOTHESIS (product): custom instructions primarily affect tone/style, not
  source coverage. Lab-level test: prompt-style mutations change style fields
  only; coverage-change on style-only mutation is a failure. Product-level
  falsifier in tests/audio/mode-semantics.md.

## 13. Testing strategy (Stage 2)

Tests live in `tests/audio/` and are deterministic unit/structural tests on
fixture plans (W1 canonical plan fixtures once frozen; audio-local minimal
fixtures before that):

- EXP-A-01/02/03 hypotheses encoded as structural tests: same plan, different
  mode ⇒ different section plans, purpose distributions, and link shapes
  (see tests/audio/mode-semantics.md for the full predicate list).
- Duration scaling: same plan+mode, smaller target ⇒ ladder effects in the
  asserted ORDER (examples dropped before claims; critical claims never
  dropped; overflow becomes an issue, not silent loss).
- Language: same plan, two languages ⇒ identical purpose sequence + coverage,
  different surface text.
- Speaker consistency: voice params stable; same-seed regeneration identical.
- Groundedness red/green: a mutated fixture with a dangling claim id fails
  validation (red); the canonical fixture passes (green).
- Turn-taking: no strict alternation, bounded ABAB runs, backchannel
  presence, same-speaker merge bounds.
- End-to-end offline: fixture plan ⇒ WAV + timing manifest + QA report +
  provenance sidecar, all committed as benchmark artifacts under
  `artifacts/` per artifacts/README.md naming (new id per generation).

Fixture-only success is not product parity (binding); tests distinguish
structural lab guarantees from product-level claims, mirroring
tests/README.md.

## 14. Planned module layout (Stage 2)

```text
src/audio/
  DESIGN.md                 (this file)
  index.ts                  public API: compileAudioOverview(plan, options)
  dialogue/
    types.ts                DialogueGraph, DialogueTurn, TurnPurpose, personas
    engine.ts               construction + validation (orphans, purposes, grounding)
    turn-taking.ts          speaker assignment, backchannels, interjections
    budget.ts               duration allocation, compression/expansion ladders
    text/
      realizer.ts           deterministic surface realization (style-aware)
  modes/
    common.ts               section-plan scaffolding shared by modes
    deep-dive.ts  brief.ts  critique.ts  debate.ts
  timing/
    timing.ts               gap policy, start/end computation
    manifest.ts             TimingManifest types + emit
  mixing/
    mix.ts                  concat + gaps (ffmpeg or pure-TS WAV)
    master.ts               loudness, format, provenance sidecar emit
  qa/
    metrics.ts              metric implementations
    pronunciation.ts        risky-token detection
    report.ts               AudioQaReport types + emit
src/providers/audio/
  README.md  port.ts  gemini-multi-speaker.ts  open-local-tts.ts   (Stage 1)
  deterministic-offline.ts  (+ thin real adapters)                  (Stage 2)
tests/audio/
  mode-semantics.md         (Stage 1, this PR)
  fixtures/ *.test.ts       (Stage 2)
```

## 15. Open questions and handoffs

> Post-freeze status per §16: items 1–3 are now ANSWERED by
> `work/wflx-w1-contracts` @ `78be437`; see the updated numbering there.

HANDOFF → W1/TL (contract needs, as originally written at design time):

1. `AudioTurn` contract must expose, at minimum: turn id, speaker id,
   realized text, claim/evidence references, target duration, and a purpose
   or style field — the graph's QA metrics depend on these being first-class.
   **ANSWERED (§16.1): all present, plus plan-level `brief` and
   `speakerRole`.**
2. `OverviewPlan` needs: emphasis weights per claim/topic, covered-set
   definition, contested/gap/weakness flags (Critique/Debate depend on them),
   language, target duration, style fields. If any are missing, Critique and
   Debate degrade to heuristics — flagged now, before freeze.
   **PARTIALLY ANSWERED (§16.4): weights/coverage/style present;
   contestedness/gap flags are NOT in ClaimRecord — remains open.**
3. Does `OverviewPlan` carry realized narration text (Director-authored), or
   does W2 realize text from claims? Design supports both (realizer is
   plan-narration-adaptive with deterministic claim realization fallback),
   but the contract should say which is authoritative.
   **ANSWERED (§16.2): plan turns carry `brief`; W2 fills `text`.**
4. Duration backpressure: a Director-side "max claims for duration" query, or
   acceptance that audio emits `over-budget` issues (default).
   **ANSWERED (§16.3): the plan is authoritative and deep-validated; W2
   fits text density and emits over-budget issues, never cuts content.**

Integration notes → W3/TL:

- `TimingManifest` is the audio side of the future Timeline Composer
  contract; W3's storyboard timing should reference the same turn ids.
- `SpeechProvider` port keeps provider structs internal; TL-side credential
  wiring constructs adapters at runtime.
- Benchmark artifacts (Stage 2) land under `artifacts/` with provenance
  sidecars and honest zero-cost labeling for the offline path.

UNRESOLVED (product-level, needs black-box runs): gap distributions, loudness
target, Brief length semantics, Debate persona persistence, interactive-mode
structure. Tracked in tests/audio/mode-semantics.md.

## 16. Contract alignment — `work/wflx-w1-contracts` @ `78be437`

Worker 1's contract freeze (branch `work/wflx-w1-contracts`, commit `78be437`,
not yet merged to main when this was written) was reviewed against this
design. This section is AUTHORITATIVE where it conflicts with earlier
sections. No shared contract was edited by W2 (path ownership respected).

### 16.1 What the frozen contracts actually say (verified)

- `OverviewPlan` carries **plan-level `audioTurns`**: the Director already
  produces the turn skeleton — speaker + `speakerRole`
  (`host-a|host-b|guest|narrator`), frozen `AudioTurnPurpose` enum
  (`framing`, `question`, `explanation`, `example`, `connection`,
  `clarification`, `interjection`, `transition`, `synthesis`, `conclusion`),
  `brief` (plan-level directive), `claimIds` + `evidence` spans, `beatId`,
  `TurnStyle` (`delivery`, optional `emphasis`), `targetDurationSeconds`,
  and `index`.
- `text` is **optional and absent at plan level — W2 fills it** (contract
  comment: "The audio compiler (Worker 2) fills `text` with the final
  narration script").
- Plans carry `beats` (weights sum to 1, deep-validated), a `CoverageMap`
  (every graph claim covered or omitted-with-reason), `language` (BCP-47),
  `targetDurationSeconds`, `PlanStyle`, `customInstructions`, and generator
  provenance with seed.
- Deep validation mutants on the W1 branch confirm: turn durations must sum
  to target (`s07`), claim refs must resolve (`s08`), all claims accounted
  (`s09`), turns must reference existing beats (`s13`).
- `GeneratedArtifact` already covers the full provenance sidecar this design
  planned: `MediaInfo` (sha256, duration, audio spec), `ProviderUsage`
  (stage `speech`, provider, model, latencyMs, costUsd), `QaSummary`
  (severity/code/message/`unitId` = smallest regenerable unit), generator
  info with seed + reproducible flag. W2 emits these; no audio-side variant
  is invented.
- Canonical audio fixture `fixtures/contracts/plan-audio-deep-dive-5min.json`:
  deep-dive, 300 s, 6 beats, 22 turns, host-a 12 / host-b 10 (already
  non-parity), purposes used: framing 5, explanation 7, question 3,
  example 2, connection 1, clarification 1, transition 1, synthesis 1,
  conclusion 1.

### 16.2 Repositioned responsibilities (supersedes §§3–5 where conflicting)

1. **Turn set, speakers, purposes, and durations are PLAN-AUTHORITATIVE.**
   W2 does not add, drop, reorder, or re-assign turns. The DialogueGraph is
   W2's working/validation/realization representation BUILT FROM
   `plan.audioTurns` — not a generator of turns.
2. **Mode compilers repositioned** to mode-aware VALIDATION + TEXT
   REALIZATION: a Critique `explanation` brief realizes in evaluative
   register; a Debate `clarification` brief realizes as rebuttal-flavored
   discourse; pacing/gap policy and QA expectations are mode-conditioned.
   Structural mode differences (which turns exist) are the Director's
   (W1's) output — W2 tests compile W1's per-mode plan fixtures and check
   realization + validation semantics, plus flag plans whose turn structure
   violates mode semantics.
3. **Compression ladder repositioned** to text-density fitting: realized
   word count per turn fits the turn's authoritative target (rate model +
   brief compression heuristics). If a turn cannot honestly realize its
   brief within target, W2 emits an `over-budget` QA issue naming the turn —
   never silently drops claims or stretches speaking rate beyond mode
   bounds.
4. **Turn-taking engine repositioned** to naturalness VALIDATION +
   text-level conversational tissue: parity-rigidity, question-answer
   pairing, and missing-interjection checks run against the PLAN's turn
   structure and surface as QA issues feeding back to the Director;
   conversational features within a frozen turn (discourse markers, natural
   question phrasing, acknowledgment openers) are realized in `text`.
   The canonical fixture currently contains NO `interjection` turns —
   noted as a fixture gap, see §16.4 item 3.
5. **Purpose taxonomy mapping.** W2's richer internal taxonomy (§3.1) is an
   ENRICHMENT layer for realization and QA; the frozen
   `AudioTurnPurpose` passes through unchanged in output. Mapping for
   enriched tags: `acknowledgement`→`interjection`, `reaction`→
   `interjection`, `opening_hook`/`agenda`→`framing`, `follow_up`→
   `question`, `recap`→`synthesis`, `takeaway`→`conclusion`, Critique
   `assessment`/`limitation`→`explanation` (evaluative register),
   `verdict`→`conclusion`, Debate `position_statement`→`framing`,
   `rebuttal`/`concession`→`clarification`, `cross_examination`→`question`.
   Enriched tags derive deterministically from (purpose, mode, stance,
   brief content) — they never rewrite contract data.
6. **Evidence and grounding.** `EvidenceSpan` (quote + UTF-16 offsets into
   `SourceBlock`s) feeds both realization (exact tokens for pronunciation
   risk) and groundedness QA. W2's groundedness checks re-validate plan
   turns against claim ids + spans — redundant with W1's deep validation by
   design (defense in depth at the audio boundary).
7. **Personas.** Plan `speakerRole` (`host-a`/`host-b`) + display name map
   onto W2 `SpeakerPersona` (voice profiles, role bias). W2 does not change
   plan speaker assignment; stance assignment (Debate) derives from brief
   content + enriched tags, flagged as HYPOTHESIS-grade until W1 exposes
   stance signals.

### 16.3 Duration model under plan authority

Beat weights (sum to 1) and per-turn targets are given. W2's timing engine
computes gaps from the policy (§6), checks total = Σ turns + Σ gaps against
`targetDurationSeconds`, and reports drift per turn after synthesis. Gap
policy remains the W2-owned tuning surface (UNRESOLVED vs product, §6).

### 16.4 Contract gaps still open (HANDOFF, do not resolve unilaterally)

1. **Contestedness / gap / weakness signals for Critique & Debate.**
   `ClaimRecord` has `kind` (incl. `opinion`, `constraint`, `goal`),
   `salience`, `negated` — but no contested/gap/weakness flag, and beats do
   not carry stance. Without a plan-level signal, Debate's contested-set and
   Critique's limitation turns rest on heuristics (kind ∈ {opinion,
   constraint} + salience ranking + brief wording) that are HYPOTHESIS-grade.
   Request: stance/contestedness fields on beats or claims, or explicit
   blessing of the heuristic with its label.
2. **Canonical audio plan fixtures per mode.** Only
   `plan-audio-deep-dive-5min.json` exists. EXP-A-01/02/03 tests need
   canonical brief/critique/debate plans over the same source graph. Until
   they exist, W2 uses audio-local stand-in fixtures labeled non-canonical
   (not product parity evidence, per tests/README.md).
   **RESOLVED 2026-09-27 (Phase 3, adjudication H-2):**
   `plan-audio-brief-2min.json`, `plan-audio-critique-5min.json` and
   `plan-audio-debate-5min.json` are now canonical — Director-emitted
   (compileOverviewPlan, fixed seeds, byte-identical regeneration enforced,
   pinned fingerprints in tests/contracts/fixtures.test.ts, EV-005).
   Structural mode predicates (turn skeletons, purpose distributions,
   coverage compression, speaker-purpose pairing) run on the canonical
   plans (tests/contracts + tests/audio/canonical-modes.test.ts); the
   keyword-heuristic enriched-tag predicates stay on the labeled stand-ins
   because the Director emits mode-agnostic briefs — see item 1 (H-1, v2
   wave). Integration finding recorded there: Director tail-beat turns are
   anchor-over-budget (tests/audio/canonical-modes.test.ts).
3. **Interjection/backchannel turns** are absent from the canonical plan.
   If natural-conversation tissue should be audible as separate turns, the
   Director must plan them; W2 will flag their absence as an
   `info`-severity QA note (not an error) until W1 rules.

### 16.5 Provider boundary confirmation

The Stage 1 `SpeechProvider` port needs no changes against the freeze:
`SpeakerId` (string) maps directly to plan `speakerRole` values; neutral
`SpeechTurnRequest.text` is the W2-filled `AudioTurn.text`; pronunciation
hints derive from `EvidenceSpan` quotes; `ProviderUsage`/`QaIssue` in
`GeneratedArtifact` cover the sidecar fields W2 emits. Adapters continue to
keep provider-specific structs internal per the handoff.
