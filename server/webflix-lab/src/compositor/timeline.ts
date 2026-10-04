/**
 * Compositor (WFLX-W3) — the video timeline.
 *
 * Pure deterministic math shared by BOTH composition backends (the Remotion
 * composition and the offline fallback frame model) and by video QA:
 * scene spans are contiguous, transitions are boundary-centered crossfades
 * (fade window T/2 on each side of the boundary, per the annotation's
 * observed 0.2-0.4 s ramps), and camera motion interpolates between the
 * motion provider's keyframes.
 *
 * Transition types beyond 'cut' and 'crossfade' (wipe, push, morph) render
 * as crossfade-equivalent opacity in this phase: the reference's observed
 * transition mix is 25 crossfades / 18 hard cuts — wipe/push/morph do not
 * appear in the annotated artifact (deferred fidelity, documented).
 */

import type { SceneMotion, VideoScene } from '../contracts';
import type { CameraKeyframe, MotionPlan } from '../providers/video/port';

export interface TimelineOptions {
  readonly fps: number;
  /** Crossfade ramp duration; defaults to 0.4 s (StyleBible observed). */
  readonly transitionSeconds?: number;
}

export type TransitionType = VideoScene['transition'];

export interface TimelineEntry {
  readonly sceneId: string;
  readonly index: number;
  readonly motion: SceneMotion;
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly startFrame: number;
  readonly endFrame: number;
  /** Transition into this scene (the boundary at startSeconds). */
  readonly transitionIn: { readonly type: TransitionType; readonly seconds: number };
  /** Transition out of this scene (the boundary at endSeconds). */
  readonly transitionOut: { readonly type: TransitionType; readonly seconds: number };
}

export interface Timeline {
  readonly fps: number;
  readonly durationSeconds: number;
  readonly totalFrames: number;
  readonly entries: readonly TimelineEntry[];
  readonly transitionSeconds: number;
}

const DEFAULT_TRANSITION_SECONDS = 0.4;

/** Build the frame-accurate timeline from contiguous plan scenes. */
export function buildTimeline(scenes: readonly VideoScene[], options: TimelineOptions): Timeline {
  if (scenes.length === 0) {
    throw new Error('buildTimeline: empty scenes');
  }
  if (options.fps <= 0) {
    throw new Error('buildTimeline: fps must be positive');
  }
  const transitionSeconds = options.transitionSeconds ?? DEFAULT_TRANSITION_SECONDS;
  const entries: TimelineEntry[] = [];
  let cursor = 0;
  scenes.forEach((scene, index) => {
    const start = cursor;
    const end = cursor + scene.targetDurationSeconds;
    const next = scenes[index + 1];
    const inSeconds =
      index === 0 || scene.transition === 'cut'
        ? 0
        : scene.transition === 'crossfade' || scene.transition === 'wipe' || scene.transition === 'push' || scene.transition === 'morph'
          ? transitionSeconds
          : 0;
    const outSeconds =
      next === undefined || next.transition === 'cut'
        ? 0
        : transitionSeconds;
    entries.push({
      sceneId: scene.id,
      index,
      motion: scene.motion,
      startSeconds: round3(start),
      endSeconds: round3(end),
      startFrame: Math.floor(start * options.fps),
      endFrame: Math.ceil(end * options.fps),
      transitionIn: { type: scene.transition, seconds: round3(inSeconds) },
      transitionOut: { type: next?.transition ?? 'cut', seconds: round3(outSeconds) },
    });
    cursor = end;
  });
  const durationSeconds = cursor;
  return {
    fps: options.fps,
    durationSeconds: round3(durationSeconds),
    totalFrames: Math.ceil(durationSeconds * options.fps),
    entries,
    transitionSeconds,
  };
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** One composited layer at a point in time. */
export interface TimelineLayer {
  readonly sceneId: string;
  readonly index: number;
  /** Blend alpha in [0, 1] (1 = fully visible). */
  readonly alpha: number;
  /** Camera transform at this instant. */
  readonly camera: CameraKeyframe;
}

function easeInOut(p: number): number {
  if (p <= 0) {
    return 0;
  }
  if (p >= 1) {
    return 1;
  }
  return p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Sample the composited layers at time t (seconds). Layers are ordered by
 * scene index (outgoing below incoming). Pure function.
 */
export function sampleTimelineLayers(
  timeline: Timeline,
  t: number,
  motions: ReadonlyMap<string, MotionPlan>,
): TimelineLayer[] {
  const layers: TimelineLayer[] = [];
  for (const entry of timeline.entries) {
    const fadeInStart = entry.startSeconds - entry.transitionIn.seconds / 2;
    const fadeInEnd = entry.startSeconds + entry.transitionIn.seconds / 2;
    const fadeOutStart = entry.endSeconds - entry.transitionOut.seconds / 2;
    const fadeOutEnd = entry.endSeconds + entry.transitionOut.seconds / 2;

    if (t < fadeInStart || t > fadeOutEnd) {
      continue;
    }
    let alpha = 1;
    if (entry.transitionIn.seconds > 0 && t < fadeInEnd) {
      alpha = Math.min(alpha, (t - fadeInStart) / entry.transitionIn.seconds);
    }
    if (entry.transitionOut.seconds > 0 && t > fadeOutStart) {
      alpha = Math.min(alpha, 1 - (t - fadeOutStart) / entry.transitionOut.seconds);
    }
    alpha = Math.max(0, Math.min(1, alpha));

    const plan =
      motions.get(entry.sceneId) ??
      ({ from: { dx: 0, dy: 0, scale: 1 }, to: { dx: 0, dy: 0, scale: 1 }, easing: 'linear' } as Pick<
        MotionPlan,
        'from' | 'to' | 'easing'
      >);
    const span = Math.max(1e-9, entry.endSeconds - entry.startSeconds);
    const raw = (t - entry.startSeconds) / span;
    const progress = plan.easing === 'ease-in-out' ? easeInOut(raw) : Math.max(0, Math.min(1, raw));
    layers.push({
      sceneId: entry.sceneId,
      index: entry.index,
      alpha,
      camera: {
        dx: lerp(plan.from.dx, plan.to.dx, progress),
        dy: lerp(plan.from.dy, plan.to.dy, progress),
        scale: lerp(plan.from.scale, plan.to.scale, progress),
      },
    });
  }
  return layers;
}

/** Frame-aligned sample times for a full render (deterministic). */
export function frameTimes(timeline: Timeline): number[] {
  const times: number[] = [];
  for (let frame = 0; frame < timeline.totalFrames; frame += 1) {
    times.push(frame / timeline.fps);
  }
  return times;
}
