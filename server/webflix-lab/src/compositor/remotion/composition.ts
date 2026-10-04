/**
 * Remotion composition (WFLX-W3) — the OverviewVideo component.
 *
 * Authored with React.createElement (no JSX) on purpose: the repo tsconfig is
 * TL-owned cross-cutting config without JSX support, and this module must not
 * force a root-config change to deliver the mandated Remotion composition.
 *
 * The composition is a thin shell: ALL timing/blend/camera math comes from
 * the shared pure timeline module (src/compositor/timeline.ts), so the
 * Remotion render and the offline fallback frame model composite identically
 * by construction. Scene SVGs arrive via inputProps and render through
 * dangerouslySetInnerHTML (deterministic markup produced by the renderer).
 */

import * as React from 'react';
import { AbsoluteFill, Audio, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import {
  sampleTimelineLayers,
  type Timeline,
  type TimelineLayer,
} from '../timeline';
import type { CameraKeyframe } from '../../providers/video/port';

/** Serializable motion plan (inputProps-friendly projection). */
export interface SerializedMotionPlan {
  readonly sceneId: string;
  readonly easing: 'linear' | 'ease-in-out';
  readonly from: CameraKeyframe;
  readonly to: CameraKeyframe;
}

/** inputProps shape (type alias on purpose: implicit index signature keeps
 *  Remotion's Composition<Props> generic inference working). */
export type OverviewCompositionProps = {
  readonly timeline: Timeline;
  readonly sceneSvgs: Readonly<Record<string, string>>;
  readonly motions: Readonly<Record<string, SerializedMotionPlan>>;
  readonly hasNarration: boolean;
};

function layerStyle(layer: TimelineLayer): React.CSSProperties {
  const transform =
    layer.camera.dx === 0 && layer.camera.dy === 0 && layer.camera.scale === 1
      ? undefined
      : `translate(${layer.camera.dx}px, ${layer.camera.dy}px) scale(${layer.camera.scale})`;
  return {
    opacity: layer.alpha,
    ...(transform !== undefined
      ? { transform, transformOrigin: '50% 50%' as const }
      : {}),
  };
}

export const OverviewVideo: React.FC<OverviewCompositionProps> = (props) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;

  const motions = new Map(
    Object.entries(props.motions).map(([sceneId, plan]) => [
      sceneId,
      { ...plan, sceneId, motion: 'static' as const, providerId: 'input', deterministic: true },
    ]),
  );
  const layers = sampleTimelineLayers(props.timeline, t, motions);

  const children: React.ReactNode[] = layers.map((layer) => {
    const svg = props.sceneSvgs[layer.sceneId];
    if (svg === undefined) {
      return null;
    }
    return React.createElement(
      AbsoluteFill,
      { key: layer.sceneId, style: layerStyle(layer) },
      React.createElement('div', {
        style: { width: '100%', height: '100%' },
        dangerouslySetInnerHTML: { __html: svg },
      }),
    );
  });

  if (props.hasNarration) {
    children.push(React.createElement(Audio, { key: 'narration', src: staticFile('narration.wav') }));
  }

  return React.createElement(AbsoluteFill, { style: { backgroundColor: '#000000' } }, children);
};

export const OVERVIEW_COMPOSITION_ID = 'wflx-overview';

/** Empty default props; real props arrive via renderMedia inputProps. */
export const EMPTY_COMPOSITION_PROPS: OverviewCompositionProps = {
  timeline: {
    fps: 30,
    durationSeconds: 1,
    totalFrames: 30,
    entries: [],
    transitionSeconds: 0.4,
  },
  sceneSvgs: {},
  motions: {},
  hasNarration: false,
};
