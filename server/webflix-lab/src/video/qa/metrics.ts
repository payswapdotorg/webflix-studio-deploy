/**
 * Video pipeline (WFLX-W3) — deterministic QA metrics.
 *
 * The Phase 2B metric set (deterministic only, per the work order):
 * 1. scene_narration_alignment — scene boundaries vs narration segment starts.
 * 2. style_consistency — rendered frames vs the StyleBible palette/typography/canvas.
 * 3. visual_grounding — every scene traceable to plan claims/entities; exact
 *    texts verified present; diagram nodes trace to grounded entities.
 * 4. determinism — renderer hash pair equality (same seed, byte-identical).
 * 5. scene_structure — durations, contiguity, transition vocabulary.
 * 6. coverage_surface — claims visualized vs plan coverage (H-4 semantics).
 */

import type { QaIssue } from '../../contracts';
import type { StyleBible } from '../style-bible';
import type { SceneGraph } from '../storyboard/types';
import type { SceneRenderTrace } from '../render/renderer';
import type { Timeline } from '../../compositor/timeline';
import { assembleReport, qaIssue, type VideoQaMetric, type VideoQaReport } from './report';

export interface NarrationSegmentTiming {
  readonly segmentId: string;
  readonly sceneId: string;
  readonly startSeconds: number;
}

export interface VideoQaInput {
  readonly storyboard: SceneGraph;
  readonly renderTraces: readonly SceneRenderTrace[];
  readonly timeline: Timeline;
  readonly narrationTimings: readonly NarrationSegmentTiming[];
  readonly styleBible: StyleBible;
  /** Second render's combined hash for the determinism proof (optional). */
  readonly determinismHashB?: string;
  /** First render's combined hash. */
  readonly determinismHashA: string;
}

/** Alignment thresholds in seconds (annotation: median cut-pause 0.128 s). */
const ALIGNMENT_WARN_SECONDS = 0.5;
const ALIGNMENT_ERROR_SECONDS = 1.5;

function bySceneId<T extends { sceneId: string }>(items: readonly T[]): Map<string, T> {
  return new Map(items.map((item) => [item.sceneId, item]));
}

export function runVideoQa(input: VideoQaInput): VideoQaReport {
  const { storyboard, timeline, styleBible } = input;
  const metrics: VideoQaMetric[] = [];

  // 1. scene/narration alignment ------------------------------------------
  {
    const issues: QaIssue[] = [];
    const timings = bySceneId(input.narrationTimings);
    let maxAbs = 0;
    let sumAbs = 0;
    let count = 0;
    for (const entry of timeline.entries) {
      const timing = timings.get(entry.sceneId);
      if (timing === undefined) {
        issues.push(
          qaIssue(
            'warning',
            'narration-segment-missing',
            `scene ${entry.sceneId} has no narration segment`,
            entry.sceneId,
          ),
        );
        continue;
      }
      const error = Math.abs(timing.startSeconds - entry.startSeconds);
      maxAbs = Math.max(maxAbs, error);
      sumAbs += error;
      count += 1;
      if (error > ALIGNMENT_ERROR_SECONDS) {
        issues.push(
          qaIssue(
            'error',
            'narration-alignment-error',
            `scene ${entry.sceneId} narration starts ${error.toFixed(3)}s from the scene boundary (> ${ALIGNMENT_ERROR_SECONDS}s)`,
            entry.sceneId,
          ),
        );
      } else if (error > ALIGNMENT_WARN_SECONDS) {
        issues.push(
          qaIssue(
            'warning',
            'narration-alignment-drift',
            `scene ${entry.sceneId} narration starts ${error.toFixed(3)}s from the scene boundary (> ${ALIGNMENT_WARN_SECONDS}s)`,
            entry.sceneId,
          ),
        );
      }
    }
    const mean = count > 0 ? sumAbs / count : 0;
    metrics.push({
      metric: 'scene_narration_alignment',
      value: `mean ${mean.toFixed(3)}s / max ${maxAbs.toFixed(3)}s over ${count} scenes (warn > ${ALIGNMENT_WARN_SECONDS}s)`,
      issues,
    });
  }

  // 2. style consistency ----------------------------------------------------
  {
    const issues: QaIssue[] = [];
    const allowedColors = new Set(
      Object.values(styleBible.palette).map((role) => role.value),
    );
    const allowedFontFamilies = new Set([
      `${styleBible.typography.labelFamily}, ui-sans-serif, system-ui, sans-serif`,
      `${styleBible.typography.codeFamily}, ui-monospace, Menlo, Consolas, monospace`,
    ]);
    let checked = 0;
    for (const trace of input.renderTraces) {
      checked += 1;
      for (const color of trace.colorsUsed) {
        if (!allowedColors.has(color)) {
          issues.push(
            qaIssue(
              'error',
              'palette-violation',
              `scene ${trace.sceneId} uses off-palette color ${color}`,
              trace.sceneId,
            ),
          );
        }
      }
      for (const font of trace.fontsUsed) {
        if (!allowedFontFamilies.has(font)) {
          issues.push(
            qaIssue(
              'error',
              'font-violation',
              `scene ${trace.sceneId} uses off-style font family '${font}'`,
              trace.sceneId,
            ),
          );
        }
      }
    }
    metrics.push({
      metric: 'style_consistency',
      value: `${checked} frames checked against ${styleBible.id} v${styleBible.styleBibleVersion} (${allowedColors.size} palette roles)`,
      issues,
    });
  }

  // 3. visual grounding -----------------------------------------------------
  {
    const issues: QaIssue[] = [];
    const traces = bySceneId(input.renderTraces);
    let groundedScenes = 0;
    for (const entry of storyboard.scenes) {
      const scene = entry.scene;
      const trace = traces.get(scene.id);
      if (scene.claimIds.length === 0) {
        issues.push(
          qaIssue(
            'warning',
            'ungrounded-scene',
            `scene ${scene.id} carries no claim ids`,
            scene.id,
          ),
        );
        continue;
      }
      if (trace === undefined) {
        issues.push(
          qaIssue('error', 'render-trace-missing', `scene ${scene.id} has no render trace`, scene.id),
        );
        continue;
      }
      const requiredTexts = scene.exactTexts
        .filter((item) => item.exact)
        .map((item) => item.value);
      const missing = requiredTexts.filter(
        (value) => !trace.exactTextsPlaced.includes(value),
      );
      for (const value of missing) {
        issues.push(
          qaIssue(
            'error',
            'exact-text-missing',
            `scene ${scene.id} does not render exact text '${value.slice(0, 60)}'`,
            scene.id,
          ),
        );
      }
      if (
        (scene.renderingClass === 'deterministic' || scene.renderingClass === 'hybrid') &&
        scene.visualType !== 'title-card' &&
        scene.visualType !== 'callout' &&
        scene.visualType !== 'quote-panel' &&
        entry.render.nodes.length > 0 &&
        trace.entityIdsPlaced.length === 0
      ) {
        issues.push(
          qaIssue(
            'warning',
            'grounding-trace-weak',
            `scene ${scene.id} placed none of its ${entry.render.nodes.length} grounded entities`,
            scene.id,
          ),
        );
      }
      groundedScenes += 1;
    }
    metrics.push({
      metric: 'visual_grounding',
      value: `${groundedScenes}/${storyboard.scenes.length} scenes carry claims; ${input.renderTraces.reduce(
        (total, trace) => total + trace.exactTextsPlaced.length,
        0,
      )} exact texts verified placed`,
      issues,
    });
  }

  // 4. determinism -----------------------------------------------------------
  {
    const issues: QaIssue[] = [];
    if (input.determinismHashB !== undefined) {
      if (input.determinismHashA !== input.determinismHashB) {
        issues.push(
          qaIssue(
            'blocker',
            'determinism-violation',
            `renderer hash pair mismatch: ${input.determinismHashA.slice(0, 12)}… != ${input.determinismHashB.slice(0, 12)}…`,
          ),
        );
      }
    }
    metrics.push({
      metric: 'determinism',
      value:
        input.determinismHashB !== undefined
          ? `hash pair equal (${input.determinismHashA.slice(0, 16)}…)`
          : `single render hash ${input.determinismHashA.slice(0, 16)}… (pair not supplied this run)`,
      issues,
    });
  }

  // 5. scene structure --------------------------------------------------------
  {
    const issues: QaIssue[] = [];
    let prevEnd = 0;
    timeline.entries.forEach((entry, position) => {
      if (entry.index !== position) {
        issues.push(
          qaIssue('error', 'timeline-index', `entry ${entry.sceneId} index mismatch`, entry.sceneId),
        );
      }
      if (Math.abs(entry.startSeconds - prevEnd) > 1e-6) {
        issues.push(
          qaIssue(
            'error',
            'timeline-gap',
            `scene ${entry.sceneId} starts at ${entry.startSeconds}s but previous ended at ${prevEnd}s`,
            entry.sceneId,
          ),
        );
      }
      if (entry.endSeconds <= entry.startSeconds) {
        issues.push(
          qaIssue('error', 'scene-zero-duration', `scene ${entry.sceneId} has non-positive span`, entry.sceneId),
        );
      }
      prevEnd = entry.endSeconds;
    });
    const drift = Math.abs(timeline.durationSeconds - storyboard.plan.targetDurationSeconds);
    if (drift > Math.max(2, storyboard.plan.targetDurationSeconds * 0.02)) {
      issues.push(
        qaIssue(
          'warning',
          'timeline-duration-drift',
          `timeline ${timeline.durationSeconds}s vs plan target ${storyboard.plan.targetDurationSeconds}s`,
        ),
      );
    }
    metrics.push({
      metric: 'scene_structure',
      value: `${timeline.entries.length} scenes, ${timeline.durationSeconds}s @ ${timeline.fps}fps (${timeline.totalFrames} frames)`,
      issues,
    });
  }

  // 6. coverage surface ---------------------------------------------------------
  {
    const issues: QaIssue[] = [];
    const sceneClaims = new Set(
      storyboard.scenes.flatMap((entry) => entry.scene.claimIds),
    );
    const covered = storyboard.plan.coverage.covered;
    const visualized = covered.filter((entry) => sceneClaims.has(entry.claimId));
    const ratio = covered.length > 0 ? visualized.length / covered.length : 1;
    for (const entry of covered) {
      if (!sceneClaims.has(entry.claimId)) {
        issues.push(
          qaIssue(
            'warning',
            'coverage-gap',
            `claim ${entry.claimId} is plan-covered but not visualized by any scene`,
          ),
        );
      }
    }
    metrics.push({
      metric: 'coverage_surface',
      value: `${visualized.length}/${covered.length} covered claims visualized (${(ratio * 100).toFixed(0)}%)`,
      issues,
    });
  }

  return assembleReport(
    {
      compiler: 'wflx-video-qa',
      planId: storyboard.meta.planId,
      planHash: storyboard.meta.planHash,
      mode: storyboard.meta.mode,
      language: storyboard.meta.language,
      seed: storyboard.meta.seed,
    },
    metrics,
  );
}
