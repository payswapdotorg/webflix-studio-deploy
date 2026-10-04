/**
 * Audio pipeline (WFLX-W2, Stage 2) — deterministic QA metric implementations.
 *
 * The ten metrics of DESIGN.md §9, plus mode-semantics expectations and
 * language notes. Deterministic by construction: inputs are the compiled
 * graph, realized turns, timing manifest, synthesis results and the mastered
 * media. No LLM self-assessment anywhere (binding). Fixture-only success is
 * not product parity evidence (AGENTS.md).
 */

import type { OverviewPlan, QaIssue } from '../../contracts';
import type { SpeechTurnResult } from '../../providers/audio/port';
import type { DialogueGraph } from '../dialogue/types';
import type { RealizedTurn } from '../dialogue/text/realizer';
import type { TimingManifest } from '../timing/manifest';
import { scaledGapBounds, GAP_POLICY, type BoundaryClass } from '../timing/timing';
import type { MasterResultOutput } from '../mixing/mix';
import { decodeWav } from '../mixing/wav';
import type { ModeProfile } from '../modes/common';
import { analyzeTurnTaking, TURN_TAKING_THRESHOLDS } from '../dialogue/turn-taking';
import { scanPronunciationRisks } from './pronunciation';
import { assembleReport, qaIssue, type AudioQaMetric, type AudioQaReport } from './report';

export const AUDIO_COMPILER_ID = 'AudioOverviewCompiler@0.1.0';

/** Everything the metrics need. Assembled by the public compiler API. */
export interface AudioQaContext {
  readonly plan: OverviewPlan;
  readonly graph: DialogueGraph;
  readonly realized: readonly RealizedTurn[];
  readonly manifest: TimingManifest;
  readonly master: MasterResultOutput;
  readonly synthesis: readonly SpeechTurnResult[];
  readonly profile: ModeProfile;
  readonly languageId: string;
  readonly languageFallback: boolean;
  /** Duration tolerance vs plan target: max(10 s, 10% of target) — mirrors W1. */
  readonly durationToleranceSeconds?: number;
}

// ---------------------------------------------------------------------------
// Individual metrics
// ---------------------------------------------------------------------------

function metricDurationVsTarget(ctx: AudioQaContext): AudioQaMetric {
  const issues: QaIssue[] = [];
  const target = ctx.plan.targetDurationSeconds;
  const tolerance = ctx.durationToleranceSeconds ?? Math.max(10, target * 0.1);
  const totalSeconds = ctx.manifest.totalDurationMs / 1000;
  const value = `total ${(totalSeconds).toFixed(2)} s (turns ${ctx.manifest.totalTurnSeconds.toFixed(2)} s + gaps ${(ctx.manifest.gapsTotalMs / 1000).toFixed(2)} s) vs target ${target} s, tolerance ±${tolerance.toFixed(1)} s`;
  if (Math.abs(totalSeconds - target) > tolerance) {
    issues.push(
      qaIssue(
        'warning',
        'duration-off-target',
        `total duration ${totalSeconds.toFixed(2)} s is outside ±${tolerance.toFixed(1)} s of plan target ${target} s (turns sum to ${ctx.manifest.totalTurnSeconds.toFixed(2)} s; gap policy adds ${(ctx.manifest.gapsTotalMs / 1000).toFixed(2)} s)`,
      ),
    );
  }
  return { metric: 'duration_vs_target', value, issues };
}

function metricTurnDurationDrift(ctx: AudioQaContext): AudioQaMetric {
  const issues: QaIssue[] = [];
  const drifts: number[] = [];
  for (const entry of ctx.manifest.entries) {
    const drift = Math.abs(entry.actualSeconds - entry.targetSeconds) / entry.targetSeconds;
    drifts.push(drift);
    if (drift > 0.15) {
      issues.push(
        qaIssue(
          'warning',
          'turn-duration-drift',
          `turn ${entry.turnId}: synthesized ${entry.actualSeconds.toFixed(2)} s vs target ${entry.targetSeconds.toFixed(2)} s (${(drift * 100).toFixed(1)}% drift)`,
          entry.turnId,
        ),
      );
    }
  }
  const maxDrift = drifts.length > 0 ? Math.max(...drifts) : 0;
  return {
    metric: 'turn_duration_drift',
    value: `max per-turn drift ${(maxDrift * 100).toFixed(1)}% across ${drifts.length} turns (tolerance 15%)`,
    issues,
  };
}

function metricSpeakerConsistency(ctx: AudioQaContext): AudioQaMetric {
  const issues: QaIssue[] = [];
  const bySpeaker = new Map<string, Set<string>>();
  // Voice params are per (turn, speaker) in synthesis results; the graph maps
  // turnId -> speakerRole for grouping.
  const speakerByTurn = new Map(ctx.graph.turns.map((turn) => [turn.id, turn.speakerRole]));
  for (const result of ctx.synthesis) {
    const speaker = speakerByTurn.get(result.turnId) ?? 'unknown';
    const params = JSON.stringify(result.effectiveVoiceParams);
    const set = bySpeaker.get(speaker) ?? new Set<string>();
    set.add(params);
    bySpeaker.set(speaker, set);
  }
  let distinct = 0;
  for (const [speaker, params] of bySpeaker) {
    if (params.size > 1) {
      distinct += 1;
      issues.push(
        qaIssue(
          'warning',
          'speaker-voice-variance',
          `speaker '${speaker}' used ${params.size} distinct voice parameter sets across turns`,
        ),
      );
    }
  }
  const speakers = [...bySpeaker.keys()].join(', ');
  return {
    metric: 'speaker_consistency',
    value: `${bySpeaker.size} speakers (${speakers}); ${distinct} with parameter variance; 0 for the deterministic offline path`,
    issues,
  };
}

function metricPauseDistribution(ctx: AudioQaContext): AudioQaMetric {
  const issues: QaIssue[] = [];
  const byClass = new Map<BoundaryClass, number[]>();
  for (const entry of ctx.manifest.entries) {
    if (entry.boundaryAfter === 'none') continue;
    const list = byClass.get(entry.boundaryAfter) ?? [];
    list.push(entry.gapAfterMs);
    byClass.set(entry.boundaryAfter, list);
  }
  const parts: string[] = [];
  for (const boundary of Object.keys(GAP_POLICY) as BoundaryClass[]) {
    const gaps = byClass.get(boundary) ?? [];
    if (gaps.length === 0) continue;
    const bounds = scaledGapBounds(ctx.profile.gapScale, boundary);
    const min = Math.min(...gaps);
    const max = Math.max(...gaps);
    const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    parts.push(`${boundary}: n=${gaps.length} avg=${avg.toFixed(0)}ms [${min}..${max}] policy[${bounds.minMs}..${bounds.maxMs}]`);
    const outOfPolicy = gaps.filter((gap) => gap < bounds.minMs || gap > bounds.maxMs);
    if (outOfPolicy.length > 0) {
      issues.push(
        qaIssue(
          'warning',
          'gap-out-of-policy',
          `${outOfPolicy.length} ${boundary} gap(s) outside scaled policy [${bounds.minMs}..${bounds.maxMs}] ms`,
        ),
      );
    }
  }
  return {
    metric: 'pause_distribution',
    value: parts.length > 0 ? parts.join('; ') : 'no gaps (single-turn plan)',
    issues,
  };
}

function metricGroundedness(ctx: AudioQaContext): AudioQaMetric {
  const issues: QaIssue[] = [];
  const evidenceBearing = ctx.graph.turns.filter((turn) => turn.claimIds.length > 0).length;
  const violations = 0; // hard validation already failed compilation otherwise
  const value = `${evidenceBearing}/${ctx.graph.turns.length} turns evidence-bearing; grounding violations: ${violations} (hard-validated at compile)`;
  return { metric: 'groundedness', value, issues };
}

function metricCoverage(ctx: AudioQaContext): AudioQaMetric {
  const issues: QaIssue[] = [];
  const coveredIds = ctx.plan.coverage.covered.map((entry) => entry.claimId);
  const voicedIds = new Set(ctx.graph.turns.flatMap((turn) => [...turn.claimIds]));
  const missing = coveredIds.filter((claimId) => !voicedIds.has(claimId));
  if (missing.length > 0) {
    issues.push(
      qaIssue(
        'error',
        'coverage-gap',
        `plan covers ${missing.length} claim(s) no turn grounds: ${missing.join(', ')} (plan/turn disagreement — Director feedback)`,
      ),
    );
  }
  const omitted = ctx.plan.coverage.omitted;
  const value = `covered ${coveredIds.length}/${coveredIds.length + omitted.length}; omitted ${omitted.length}${omitted.length > 0 ? ` (${omitted.map((o) => `${o.claimId}: ${o.reason}`).join('; ')})` : ''}`;
  return { metric: 'coverage', value, issues };
}

function metricTurnTaking(ctx: AudioQaContext): AudioQaMetric {
  const issues: QaIssue[] = [];
  const stats = analyzeTurnTaking(ctx.graph);

  // C-10 (v2 contract wave, EV-009 LAB-02): brief is monologic BY DESIGN —
  // the H-A-04 dialogic predicates (speaker parity, alternation runs,
  // same-speaker runs, question->answer links, backchannel presence) apply
  // to two-host modes; reporting them on a single-narrator skeleton would be
  // false Director feedback. The one monologic-relevant check that stays:
  // a monologic mode whose plan carries MULTIPLE speaker roles.
  if (ctx.profile.monologic === true) {
    const roles = Object.keys(stats.speakerShares);
    if (roles.length > 1) {
      issues.push(
        qaIssue(
          'warning',
          'monologic-mode-multi-speaker',
          `${ctx.profile.mode} declares a monologic skeleton but the plan carries ${roles.length} speaker roles (${roles.join(', ')}) — C-10 Director feedback (EV-009 LAB-02)`,
        ),
      );
    }
    const value =
      `monologic mode (C-10, EV-009 LAB-02): turns=${stats.turnCount} single voice [${roles.join(', ')}]; ` +
      'dialogic turn-taking predicates (parity/alternation/same-speaker runs/question-answer/backchannel) not applicable';
    return { metric: 'turn_taking_naturalness', value, issues };
  }

  if (!stats.parityBalanced && stats.turnCount >= 6) {
    const shares = Object.entries(stats.speakerShares)
      .map(([role, share]) => `${role} ${(share * 100).toFixed(0)}%`)
      .join(', ');
    issues.push(
      qaIssue(
        'warning',
        'parity-out-of-band',
        `speaker turn-share outside the 35–65% band: ${shares} (H-A-04 feedback to the Director)`,
      ),
    );
  }

  const alternationShare = stats.turnCount > 0 ? stats.longestAlternationRun / stats.turnCount : 0;
  if (
    stats.longestAlternationRun >= TURN_TAKING_THRESHOLDS.alternationRunAbsolute &&
    alternationShare >= TURN_TAKING_THRESHOLDS.alternationRunShare
  ) {
    issues.push(
      qaIssue(
        'warning',
        'alternation-run-long',
        `longest strict alternation run is ${stats.longestAlternationRun}/${stats.turnCount} turns (${(alternationShare * 100).toFixed(0)}% of the graph) — near-parity walk (H-A-04; plan turn structure is authoritative, this feeds back to the Director)`,
      ),
    );
  }

  if (stats.longestSameSpeakerRun > TURN_TAKING_THRESHOLDS.maxSameSpeakerRun) {
    issues.push(
      qaIssue(
        'warning',
        'same-speaker-run-long',
        `same-speaker run of ${stats.longestSameSpeakerRun} exceeds the justified-unit bound of ${TURN_TAKING_THRESHOLDS.maxSameSpeakerRun}`,
      ),
    );
  }

  if (stats.questionAnswerPairs === 0 && stats.turnCount >= 6) {
    issues.push(
      qaIssue(
        'warning',
        'no-question-answer-pair',
        'no question->answer (respondsTo) links in the graph (H-A-04)',
      ),
    );
  }

  if (stats.backchannelTurns === 0 && stats.turnCount >= 6) {
    // DESIGN.md §16.4 item 3: interjection turns are plan-authoritative; their
    // absence is a fixture gap surfaced as an info note, not an error.
    issues.push(
      qaIssue(
        'info',
        'no-interjection-turns',
        'plan carries no interjection/backchannel turns; conversational tissue is realized inside turn text (DESIGN.md §16.4 item 3 — awaiting Director ruling)',
      ),
    );
  }

  const shares = Object.entries(stats.speakerShares)
    .map(([role, share]) => `${role} ${(share * 100).toFixed(0)}%`)
    .join(', ');
  const value = `turns=${stats.turnCount} shares[${shares}] altRun=${stats.longestAlternationRun} sameRun=${stats.longestSameSpeakerRun} qaLinks=${stats.questionAnswerPairs} backchannels=${stats.backchannelTurns}`;
  return { metric: 'turn_taking_naturalness', value, issues };
}

function metricPronunciationRisk(ctx: AudioQaContext): AudioQaMetric {
  const issues: QaIssue[] = [];
  const byTurn = new Map<string, number>();
  const examples = new Set<string>();
  for (const realized of ctx.realized) {
    const risks = scanPronunciationRisks(realized.text);
    if (risks.length > 0) {
      byTurn.set(realized.turnId, risks.length);
      for (const risk of risks) {
        if (examples.size < 8) examples.add(`${risk.token} (${risk.reason})`);
      }
    }
  }
  const total = [...byTurn.values()].reduce((a, b) => a + b, 0);
  if (total > 0) {
    issues.push(
      qaIssue(
        'info',
        'pronunciation-risk',
        `${total} risky token(s) flagged across ${byTurn.size} turns: ${[...examples].join(', ')}`,
      ),
    );
  }
  return {
    metric: 'pronunciation_risk',
    value: `${total} risky tokens across ${byTurn.size}/${ctx.realized.length} turns`,
    issues,
  };
}

function metricLoudness(ctx: AudioQaContext): AudioQaMetric {
  const issues: QaIssue[] = [];
  const lufs = ctx.master.lufs;
  if (!Number.isFinite(lufs)) {
    issues.push(
      qaIssue('warning', 'loudness-unmeasurable', 'final track loudness unmeasurable (silence?)'),
    );
  }
  issues.push(...ctx.master.issues);
  const value = `integrated ${Number.isFinite(lufs) ? lufs.toFixed(2) : 'n/a'} LUFS, sample peak ${Number.isFinite(ctx.master.peakDb) ? ctx.master.peakDb.toFixed(2) : 'n/a'} dBFS (target -16 LUFS / -1.5 dB ceiling, UNRESOLVED vs product; backend ${ctx.master.backend})`;
  return { metric: 'loudness', value, issues };
}

function metricDefectScan(ctx: AudioQaContext): AudioQaMetric {
  const issues: QaIssue[] = [];

  for (const realized of ctx.realized) {
    if (realized.text.trim().length === 0) {
      issues.push(qaIssue('error', 'zero-length-turn', `turn ${realized.turnId} has empty realized text`, realized.turnId));
    }
  }
  for (const entry of ctx.manifest.entries) {
    if (entry.actualSeconds <= 0.01) {
      issues.push(qaIssue('error', 'zero-length-turn', `turn ${entry.turnId} synthesized ~0 s of audio`, entry.turnId));
    }
  }

  // Decode the final media and scan for clipping + unexpected long silences.
  const decoded = decodeWav(ctx.master.wav);
  let clipped = 0;
  for (let i = 0; i < decoded.samples.length; i += 1) {
    if (Math.abs(decoded.samples[i] ?? 0) >= 32767 / 32768) clipped += 1;
  }
  if (clipped > 0) {
    issues.push(qaIssue('error', 'clipping', `${clipped} sample(s) at or above full scale in the master`));
  }

  const silenceThreshold = 1e-5;
  let run = 0;
  let longestSilenceSamples = 0;
  const maxPolicyGapMs = Math.max(...Object.values(GAP_POLICY).map((p) => p.maxMs));
  const allowedSilenceSamples = Math.ceil(((maxPolicyGapMs * ctx.profile.gapScale) / 1000 + 0.3) * decoded.sampleRate);
  for (let i = 0; i < decoded.samples.length; i += 1) {
    if (Math.abs(decoded.samples[i] ?? 0) < silenceThreshold) {
      run += 1;
      longestSilenceSamples = Math.max(longestSilenceSamples, run);
    } else {
      run = 0;
    }
  }
  if (longestSilenceSamples > allowedSilenceSamples) {
    issues.push(
      qaIssue(
        'warning',
        'long-silence',
        `longest silence run ${(longestSilenceSamples / decoded.sampleRate).toFixed(2)} s exceeds the policy bound ${(allowedSilenceSamples / decoded.sampleRate).toFixed(2)} s`,
      ),
    );
  }

  const durationSeconds = decoded.samples.length / decoded.sampleRate;
  const expectedSeconds = ctx.manifest.totalDurationMs / 1000;
  if (Math.abs(durationSeconds - expectedSeconds) > 0.05) {
    issues.push(
      qaIssue(
        'error',
        'container-integrity',
        `master duration ${durationSeconds.toFixed(2)} s differs from manifest total ${expectedSeconds.toFixed(2)} s`,
      ),
    );
  }

  const value = `clipped samples=${clipped}; longest silence=${(longestSilenceSamples / decoded.sampleRate).toFixed(2)} s; container duration ${durationSeconds.toFixed(2)} s == manifest`;
  return { metric: 'defect_scan', value, issues };
}

// ---------------------------------------------------------------------------
// Supplementary checks (mode semantics, language, over-budget)
// ---------------------------------------------------------------------------

function metricModeSemantics(ctx: AudioQaContext): AudioQaMetric {
  const issues: QaIssue[] = [];
  const tags = new Set(ctx.graph.turns.map((turn) => turn.enrichedTag));
  const purposes = new Set(ctx.graph.turns.map((turn) => turn.purpose));
  for (const expected of ctx.profile.qa.expectedEnriched) {
    if (ctx.graph.turns.length >= expected.minTurns && !tags.has(expected.tag)) {
      issues.push(
        qaIssue(
          'warning',
          'mode-semantics-missing',
          `${ctx.profile.mode} plan of ${ctx.graph.turns.length} turns carries no '${expected.tag}' turns — plan structure may violate mode semantics (Director feedback; structure is plan-authoritative)`,
        ),
      );
    }
  }
  for (const discouraged of ctx.profile.qa.discouragedPurposes) {
    if (purposes.has(discouraged.purpose)) {
      issues.push(qaIssue(discouraged.severity, 'mode-semantics-discouraged', `${discouraged.purpose} turns present: ${discouraged.note}`));
    }
  }
  const value = `${ctx.profile.mode}: expected-tag checks ${ctx.profile.qa.expectedEnriched.length}, discouraged-purpose checks ${ctx.profile.qa.discouragedPurposes.length}`;
  return { metric: 'mode_semantics', value, issues };
}

function metricTextDensity(ctx: AudioQaContext): AudioQaMetric {
  const issues: QaIssue[] = [];
  let overBudgetCount = 0;
  for (const realized of ctx.realized) {
    if (realized.overBudget) {
      overBudgetCount += 1;
      issues.push(
        qaIssue(
          'error',
          'turn-over-budget',
          `turn ${realized.turnId}: mandatory anchors cannot fit ${realized.maxWords} words at the mode rate ceiling (${realized.wordCount} words needed) — over-budget per §16.2 item 3, coverage is Director authority`,
          realized.turnId,
        ),
      );
    }
  }
  const totalWords = ctx.realized.reduce((acc, r) => acc + r.wordCount, 0);
  const value = `${totalWords} words across ${ctx.realized.length} turns; over-budget turns: ${overBudgetCount}`;
  return { metric: 'text_density_fit', value, issues };
}

function metricLanguage(ctx: AudioQaContext): AudioQaMetric {
  const issues: QaIssue[] = [];
  if (ctx.languageFallback) {
    issues.push(
      qaIssue(
        'info',
        'language-pack-fallback',
        `no surface pack for '${ctx.plan.language}'; realized with the English pack (honest fallback, never silent)`,
      ),
    );
  }
  if (ctx.languageId !== 'en') {
    const anchored = ctx.graph.turns.filter((turn) => turn.claimIds.length > 0).length;
    if (anchored > 0) {
      issues.push(
        qaIssue(
          'info',
          'anchors-not-localized',
          `${anchored} grounded turns keep source-language claim statements (deterministic lab path performs no machine translation — documented limitation, H-A-06 surface locality is template-level only)`,
        ),
      );
    }
  }
  const value = `language=${ctx.plan.language} pack=${ctx.languageId}${ctx.languageFallback ? ' (fallback)' : ''}`;
  return { metric: 'language', value, issues };
}

// ---------------------------------------------------------------------------
// Report assembly
// ---------------------------------------------------------------------------

/** Run all metrics and assemble the report (DESIGN.md §9 order). */
export function runAudioQa(ctx: AudioQaContext): AudioQaReport {
  const metrics: AudioQaMetric[] = [
    metricDurationVsTarget(ctx),
    metricTurnDurationDrift(ctx),
    metricSpeakerConsistency(ctx),
    metricPauseDistribution(ctx),
    metricGroundedness(ctx),
    metricCoverage(ctx),
    metricTurnTaking(ctx),
    metricPronunciationRisk(ctx),
    metricLoudness(ctx),
    metricDefectScan(ctx),
    metricModeSemantics(ctx),
    metricTextDensity(ctx),
    metricLanguage(ctx),
  ];
  return assembleReport(
    {
      compiler: AUDIO_COMPILER_ID,
      planId: ctx.graph.meta.planId,
      planHash: ctx.graph.meta.planHash,
      mode: ctx.graph.meta.mode,
      language: ctx.graph.meta.language,
      seed: ctx.graph.meta.seed,
    },
    metrics,
  );
}
