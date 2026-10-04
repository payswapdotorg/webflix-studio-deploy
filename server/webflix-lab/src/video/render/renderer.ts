/**
 * Video pipeline (WFLX-W3) — the deterministic scene renderer.
 *
 * Renders each storyboard scene as a complete standalone SVG frame
 * (1280x720) from its render spec + StyleBible + grounding. Identical inputs
 * produce byte-identical SVG: no randomness, no clocks, stable ordering,
 * fixed number formatting, and the illustration fragment (provider-produced
 * markup, itself deterministic in the offline path) is embedded verbatim.
 *
 * Exact-text contract: every exactTexts value of a deterministic/hybrid scene
 * must appear in the rendered frame; the trace records which values were
 * placed so visual-grounding QA can verify containment.
 */

import { createHash } from 'node:crypto';
import type { Id } from '../../contracts';
import type { StyleBible } from '../style-bible';
import type { RenderSpec, StoryboardScene } from '../storyboard/types';
import { layoutFrame, ILLUSTRATION_PLACEHOLDER, type LayoutTrace } from './layouts';
import { el, fmt, serialize, svgContainsText } from './svg';

export interface SceneRenderTrace {
  readonly sceneId: Id;
  readonly visualType: string;
  readonly byteLength: number;
  readonly colorsUsed: readonly string[];
  readonly fontsUsed: readonly string[];
  /** Exact text values verified to appear in the frame. */
  readonly exactTextsPlaced: readonly string[];
  /** Entity ids whose labels are placed in the frame (grounding trace). */
  readonly entityIdsPlaced: readonly string[];
  readonly sha256: string;
}

export interface RenderSceneInput {
  readonly spec: RenderSpec;
  readonly styleBible: StyleBible;
  /** Pre-resolved illustration fragment for the generative layer, if any. */
  readonly illustration?: string;
}

/** Render one scene to a complete SVG document string. Pure + deterministic. */
export function renderSceneSvg(input: RenderSceneInput): string {
  const { spec, styleBible } = input;
  const trace: LayoutTrace = { colors: new Set(), fonts: new Set() };
  const content = layoutFrame({
    spec,
    styleBible,
    trace,
    placed: new Set<string>(),
    ...(input.illustration !== undefined ? { illustration: input.illustration } : {}),
  });

  const root = el(
    'svg',
    {
      xmlns: 'http://www.w3.org/2000/svg',
      width: String(styleBible.layout.widthPx),
      height: String(styleBible.layout.heightPx),
      viewBox: `0 0 ${styleBible.layout.widthPx} ${styleBible.layout.heightPx}`,
    },
    [
      el('rect', {
        x: '0',
        y: '0',
        width: String(styleBible.layout.widthPx),
        height: String(styleBible.layout.heightPx),
        fill: styleBible.palette.background.value,
      }),
      ...content,
    ],
  );

  let svg = serialize(root);

  // Substitute illustration placeholders with the provider fragment.
  if (input.illustration !== undefined) {
    const fragment = input.illustration.trim();
    svg = svg
      .replaceAll(
        `<g data-wflx-illustration="${ILLUSTRATION_PLACEHOLDER}"/>`,
        `<g>${fragment}</g>`,
      )
      .replaceAll(
        `<g data-wflx-illustration="${ILLUSTRATION_PLACEHOLDER}" opacity="0.5"/>`,
        `<g opacity="0.5">${fragment}</g>`,
      )
      .replaceAll(
        `<g data-wflx-illustration="${ILLUSTRATION_PLACEHOLDER}" opacity="0.9"/>`,
        `<g opacity="0.9">${fragment}</g>`,
      );
  }
  return svg;
}

/** Build the grounding/layout trace for a rendered scene. */
export function traceSceneRender(
  scene: StoryboardScene,
  svg: string,
  trace: LayoutTrace,
): SceneRenderTrace {
  const exactTextsPlaced = scene.scene.exactTexts
    .filter((item) => svgContainsText(svg, item.value))
    .map((item) => item.value);
  const entityIdsPlaced = scene.render.nodes
    .filter((node) => svgContainsText(svg, node.label))
    .map((node) => node.id);
  return {
    sceneId: scene.scene.id,
    visualType: scene.scene.visualType,
    byteLength: Buffer.byteLength(svg, 'utf8'),
    colorsUsed: [...trace.colors].sort(),
    fontsUsed: [...trace.fonts].sort(),
    exactTextsPlaced,
    entityIdsPlaced,
    sha256: createHash('sha256').update(svg, 'utf8').digest('hex'),
  };
}

export interface RenderStoryboardInput {
  readonly storyboard: readonly StoryboardScene[];
  readonly styleBible: StyleBible;
  /** Pre-resolved illustration fragments keyed by scene id. */
  readonly illustrations?: ReadonlyMap<Id, string>;
}

export interface RenderStoryboardResult {
  /** Complete SVG documents keyed by scene id (insertion order = plan order). */
  readonly frames: ReadonlyMap<Id, string>;
  readonly traces: readonly SceneRenderTrace[];
  /** sha256 over all frames in plan order — the determinism proof hash. */
  readonly combinedSha256: string;
  readonly renderBytes: number;
}

/** Render every storyboard scene. Pure + deterministic given the fragments. */
export function renderStoryboardSvg(input: RenderStoryboardInput): RenderStoryboardResult {
  const frames = new Map<Id, string>();
  const traces: SceneRenderTrace[] = [];
  let renderBytes = 0;
  for (const scene of input.storyboard) {
    const illustration = input.illustrations?.get(scene.scene.id);
    const svg = renderSceneSvg({
      spec: scene.render,
      styleBible: input.styleBible,
      ...(illustration !== undefined ? { illustration } : {}),
    });
    frames.set(scene.scene.id, svg);
    renderBytes += Buffer.byteLength(svg, 'utf8');
    traces.push(
      traceSceneRender(
        scene,
        svg,
        // Re-derive the trace sets by rendering layout bookkeeping is not
        // possible post-hoc; approximate containment checks are exact, and
        // color/font sets are re-scanned from the SVG for QA honesty.
        { colors: scanColors(svg), fonts: scanFonts(svg) },
      ),
    );
  }
  const hash = createHash('sha256');
  for (const [sceneId, svg] of frames) {
    hash.update(sceneId);
    hash.update(svg);
  }
  return { frames, traces, combinedSha256: hash.digest('hex'), renderBytes };
}

/** Scan an SVG document for hex colors used in fill/stroke attributes. */
export function scanColors(svg: string): Set<string> {
  const colors = new Set<string>();
  const re = /(?:fill|stroke)="(#[0-9a-f]{6})"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(svg)) !== null) {
    const hex = match[1];
    if (hex !== undefined) {
      colors.add(hex);
    }
  }
  return colors;
}

/** Scan an SVG document for font-family values in use. */
export function scanFonts(svg: string): Set<string> {
  const fonts = new Set<string>();
  const re = /font-family="([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(svg)) !== null) {
    const family = match[1];
    if (family !== undefined) {
      fonts.add(family);
    }
  }
  return fonts;
}

export { fmt };
