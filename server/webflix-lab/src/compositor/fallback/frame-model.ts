/**
 * Fallback compositor (WFLX-W3) — deterministic frame model.
 *
 * Renders the composited frame at an arbitrary time t as a standalone SVG
 * document: one layer per active scene (sampled from the shared timeline
 * math), camera transforms applied as SVG transforms around the canvas
 * center, crossfade alphas as group opacity. Pure function of
 * (timeline, scene SVGs, motion plans, t) — byte-identical for identical
 * inputs, no browser required.
 */

import type { MotionPlan } from '../../providers/video/port';
import { sampleTimelineLayers, type Timeline } from '../timeline';

const CANVAS_W = 1280;
const CANVAS_H = 720;

function esc(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function fmt(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2).replace(/\.?0+$/, '') || '0';
}

function cameraTransform(dx: number, dy: number, scale: number): string {
  if (dx === 0 && dy === 0 && scale === 1) {
    return '';
  }
  return `translate(${fmt(dx)} ${fmt(dy)}) translate(640 360) scale(${fmt(scale)}) translate(-640 -360)`;
}

/** Render the composited frame at time t (seconds) as an SVG document. */
export function renderFrameAt(
  timeline: Timeline,
  sceneSvgs: ReadonlyMap<string, string>,
  motions: ReadonlyMap<string, MotionPlan>,
  t: number,
): string {
  const layers = sampleTimelineLayers(timeline, t, motions);
  const parts: string[] = [];
  for (const layer of layers) {
    const svg = sceneSvgs.get(layer.sceneId);
    if (svg === undefined) {
      continue;
    }
    // Strip the XML declaration; keep the root <svg> attrs via a wrapping
    // group inside the layer viewport.
    const inner = svg
      .replace(/^<\?xml[^>]*\?>/, '')
      .replace(/^<svg[^>]*>/, '')
      .replace(/<\/svg>$/, '');
    const transform = cameraTransform(layer.camera.dx, layer.camera.dy, layer.camera.scale);
    parts.push(
      `<svg x="0" y="0" width="${CANVAS_W}" height="${CANVAS_H}" viewBox="0 0 ${CANVAS_W} ${CANVAS_H}"` +
        `${transform !== '' ? ` transform="${esc(transform)}"` : ''}>` +
        `<g opacity="${fmt(layer.alpha)}">${inner}</g></svg>`,
    );
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS_W}" height="${CANVAS_H}" ` +
    `viewBox="0 0 ${CANVAS_W} ${CANVAS_H}">` +
    `<rect x="0" y="0" width="${CANVAS_W}" height="${CANVAS_H}" fill="#000000"/>` +
    `${parts.join('')}</svg>`
  );
}
