# Overview Director

Worker 1 owns this tree. Stage-2 implementation (WFLX-W1):

- `compiler.ts` — `compileOverviewPlan(DirectorRequest) -> OverviewPlan`.
  The Director owns editorial decisions only (what to include, ordering,
  emphasis, omissions, audience, duration, beat/turn/scene objectives); it
  never generates speech, images or video.
  - Deterministic and seeded: identical inputs + seed produce byte-identical
    plans. The seed only affects equal-salience tie-breaking and transition
    pattern offsets — never grounding.
  - Claim selection is budget-driven (`secondsPerClaim` editorial prior,
    default 27s) and salience-ranked; every selected or skipped claim is
    accounted for in the coverage map (covered with role / omitted with
    reason).
  - Custom instructions NEVER change claim coverage — they are recorded for
    style-level consumption (EXP-V-03 falsifier anchor).
  - Mode profiles encode DOCUMENTED formats; speaker counts and purpose
    patterns per mode are HYPOTHESIS priors pending black-box comparison.
- `evaluate.ts` — groundedness/coverage evaluator: `evaluateCoverage` for
  plans, `evaluateAudioTurns` / `evaluateVideoScenes` for Worker 2/3
  later-stage turn/scene lists (unsupported refs, evidence linkage, exact
  label grounding for fact-bearing roles per scene-atlas rule 2).

Pipeline: SourceAdapter -> DeterministicExtractor -> compileOverviewPlan ->
evaluateCoverage, all offline (see tests/director/compiler.test.ts).
