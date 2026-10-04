/**
 * Remotion entrypoint (WFLX-W3) — registers the OverviewVideo composition.
 *
 * Bundled by @remotion/bundler at render time (src/compositor/render.ts).
 * Duration/fps metadata is computed per render from the inputProps timeline
 * via `calculateMetadata`, so one registered composition serves every plan.
 *
 * Note: Remotion's `Composition<Schema, Props>` generic does not infer
 * cleanly through React.createElement (its PropsIfHasProps conditional
 * requires zod-schema unification); the component is bound once with an
 * explicit cast. Runtime behavior is unchanged.
 */

import * as React from 'react';
import { Composition, registerRoot } from 'remotion';
import {
  EMPTY_COMPOSITION_PROPS,
  OVERVIEW_COMPOSITION_ID,
  OverviewVideo,
  type OverviewCompositionProps,
} from './composition';

type BoundCompositionProps = {
  readonly id: string;
  readonly component: React.FC<OverviewCompositionProps>;
  readonly durationInFrames: number;
  readonly fps: number;
  readonly width: number;
  readonly height: number;
  readonly defaultProps: OverviewCompositionProps;
  readonly calculateMetadata: (options: {
    readonly props: OverviewCompositionProps;
  }) => {
    readonly durationInFrames: number;
    readonly fps: number;
    readonly width: number;
    readonly height: number;
  };
};

const TypedComposition = Composition as unknown as React.FC<BoundCompositionProps>;

export const RemotionRoot: React.FC = () =>
  React.createElement(TypedComposition, {
    id: OVERVIEW_COMPOSITION_ID,
    component: OverviewVideo,
    durationInFrames: 30,
    fps: 30,
    width: 1280,
    height: 720,
    defaultProps: EMPTY_COMPOSITION_PROPS,
    calculateMetadata: ({ props }) => ({
      durationInFrames: Math.max(1, Math.ceil(props.timeline.durationSeconds * props.timeline.fps)),
      fps: props.timeline.fps,
      width: 1280,
      height: 720,
    }),
  });

registerRoot(RemotionRoot);
