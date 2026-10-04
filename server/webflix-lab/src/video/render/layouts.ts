/**
 * Video pipeline (WFLX-W3) — deterministic per-type frame layouts.
 *
 * Each layout implements the StyleBible grammar for one visual type of the
 * W1 contract vocabulary: center-weighted composition, graphite ground,
 * cyan/teal emphasis ink, ALL-CAPS labels, hexagonal nodes, generous
 * negative space (annotation reconstruction rules 1-10).
 *
 * Determinism: pure functions of (spec, styleBible, illustration fragment);
 * stable element order; fixed number formatting via fmt().
 */

import type { StyleBible } from '../style-bible';
import type { RenderSpec } from '../storyboard/types';
import {
  circlePoints,
  el,
  fmt,
  hexagonPoints,
  measureText,
  shortenSegment,
  stableHash,
  truncateToWidth,
  wrapText,
  type Point,
  type SvgNode,
} from './svg';

/** Collected usage trace for style-consistency QA. */
export interface LayoutTrace {
  readonly colors: Set<string>;
  readonly fonts: Set<string>;
}

export interface LayoutContext {
  readonly spec: RenderSpec;
  readonly styleBible: StyleBible;
  readonly trace: LayoutTrace;
  /** Generative illustration fragment (SVG content, 0..W / 0..H space). */
  readonly illustration?: string;
  /**
   * Ledger of exact texts already placed verbatim by the primary layout.
   * `placeRemainingTexts` guarantees every spec.labels/title/caption value
   * lands in the frame (contract: exact texts must appear).
   */
  readonly placed: Set<string>;
}

/** Mark a text as placed verbatim (ledger bookkeeping). */
function markPlaced(ctx: LayoutContext, value: string | undefined): void {
  if (value !== undefined && value !== '') {
    ctx.placed.add(value);
  }
}

/**
 * Deterministic font fitting: largest size (from preferred down to min) at
 * which the value fits maxWidth on one line; otherwise wraps at the largest
 * size that fits within maxLines. Returns the chosen size and lines.
 */
export function fitTextLines(
  value: string,
  maxWidthPx: number,
  preferredSize: number,
  minSize: number,
  isMono = false,
  maxLines = 2,
): { size: number; lines: string[] } {
  for (let size = preferredSize; size >= minSize; size -= 2) {
    if (measureText(value, size, isMono) <= maxWidthPx) {
      return { size, lines: [value] };
    }
  }
  for (let size = preferredSize; size >= minSize; size -= 2) {
    const lines = wrapText(value, maxWidthPx, size, isMono, maxLines + 1);
    if (
      lines.length <= maxLines &&
      lines.every((line) => measureText(line, size, isMono) <= maxWidthPx && !line.includes('…'))
    ) {
      return { size, lines };
    }
  }
  // Last resort: allow one extra row rather than losing text.
  return { size: minSize, lines: wrapText(value, maxWidthPx, minSize, isMono, maxLines + 1) };
}

const CANVAS_W = 1280;
const CANVAS_H = 720;

function trackColor(trace: LayoutTrace, hex: string): string {
  trace.colors.add(hex);
  return hex;
}

function textNode(
  ctx: LayoutContext,
  x: number,
  y: number,
  value: string,
  opts: {
    size: number;
    fill: string;
    weight?: number;
    anchor?: 'start' | 'middle' | 'end';
    mono?: boolean;
    spacing?: number;
    italic?: boolean;
  },
): SvgNode {
  const { styleBible, trace } = ctx;
  const family = opts.mono
    ? `${styleBible.typography.codeFamily}, ui-monospace, Menlo, Consolas, monospace`
    : `${styleBible.typography.labelFamily}, ui-sans-serif, system-ui, sans-serif`;
  trace.fonts.add(family);
  trackColor(trace, opts.fill);
  const attrs: Record<string, string> = {
    x: fmt(x),
    y: fmt(y),
    'font-family': family,
    'font-size': String(opts.size),
    fill: opts.fill,
    ...(opts.weight !== undefined ? { 'font-weight': String(opts.weight) } : {}),
    ...(opts.anchor !== undefined ? { 'text-anchor': opts.anchor } : {}),
    ...(opts.spacing !== undefined ? { 'letter-spacing': fmt(opts.spacing) } : {}),
    ...(opts.italic === true ? { 'font-style': 'italic' } : {}),
  };
  return el('text', attrs, [], value);
}

/** StyleBible label case normalization (observed: ALL-CAPS labels). */
function labelize(ctx: LayoutContext, value: string): string {
  const casing = ctx.styleBible.typography.labelCase;
  if (casing === 'upper') {
    return value.toUpperCase();
  }
  if (casing === 'title') {
    return value.replace(/\b\w/g, (ch) => ch.toUpperCase());
  }
  return value;
}

function frameChrome(ctx: LayoutContext): SvgNode {
  const { styleBible } = ctx;
  const m = styleBible.layout.marginPx;
  return el(
    'g',
    { opacity: '0.35' },
    [
      el('rect', {
        x: fmt(m),
        y: fmt(m),
        width: fmt(CANVAS_W - 2 * m),
        height: fmt(CANVAS_H - 2 * m),
        fill: 'none',
        stroke: trackColor(ctx.trace, styleBible.palette.emphasisSoft.value),
        'stroke-width': '1',
        rx: '6',
      }),
    ],
  );
}

function embedIllustrationFragment(fragment: string, alpha = 1): string {
  const inner = fragment.replace(/^<\?xml[^>]*\?>/, '').trim();
  const open = `<svg x="0" y="0" width="${CANVAS_W}" height="${CANVAS_H}" viewBox="0 0 ${CANVAS_W} ${CANVAS_H}"`;
  return `${open}${alpha < 1 ? ` opacity="${fmt(alpha)}"` : ''}>${inner}</svg>`;
}

/** Marker the renderer substitutes with the provider illustration fragment. */
export const ILLUSTRATION_PLACEHOLDER = '__WFLX_ILLUSTRATION__';

function illustrationLayer(ctx: LayoutContext, alpha = 1): SvgNode {
  // Placeholder node; the renderer substitutes the provider fragment here.
  return el('g', {
    'data-wflx-illustration': ILLUSTRATION_PLACEHOLDER,
    ...(alpha < 1 ? { opacity: fmt(alpha) } : {}),
  });
}

export { embedIllustrationFragment };

// ---------------------------------------------------------------------------
// title-card
// ---------------------------------------------------------------------------

function layoutTitle(ctx: LayoutContext): SvgNode[] {
  const { spec, styleBible } = ctx;
  const title = spec.title ?? spec.labels[0] ?? 'Overview';
  const caption = spec.caption ?? spec.labels[1];
  markPlaced(ctx, title);
  markPlaced(ctx, caption);
  const cy = CANVAS_H / 2;
  const nodes: SvgNode[] = [frameChrome(ctx)];
  // Controller-knot motif above the title (annotation recurring motif).
  const motifR = 34;
  const motifY = cy - 130;
  nodes.push(
    el('g', { opacity: '0.9' }, [
      el('polygon', {
        points: hexagonPoints(CANVAS_W / 2, motifY, motifR),
        fill: 'none',
        stroke: trackColor(ctx.trace, styleBible.palette.emphasis.value),
        'stroke-width': '2',
      }),
      el('polygon', {
        points: hexagonPoints(CANVAS_W / 2, motifY, motifR * 0.55),
        fill: 'none',
        stroke: trackColor(ctx.trace, styleBible.palette.emphasisDeep.value),
        'stroke-width': '1.5',
      }),
    ]),
  );
  const fit = fitTextLines(title, CANVAS_W - 220, styleBible.typography.titleSizePx, 36, false, 2);
  const titleSize = fit.size;
  const titleLines = fit.lines;
  let ty = cy - 30 - (titleLines.length - 1) * (titleSize * 0.62);
  for (const line of titleLines) {
    nodes.push(
      textNode(ctx, CANVAS_W / 2, ty, line, {
        size: titleSize,
        fill: styleBible.palette.ink.value,
        weight: styleBible.typography.titleWeight,
        anchor: 'middle',
        spacing: 1.5,
      }),
    );
    ty += titleSize * 1.18;
  }
  // Motif rule (annotation): thin emphasis rule under the title.
  const ruleY = ty + 6;
  nodes.push(
    el('rect', {
      x: fmt(CANVAS_W / 2 - 90),
      y: fmt(ruleY),
      width: '180',
      height: '3',
      rx: '1.5',
      fill: trackColor(ctx.trace, styleBible.palette.emphasis.value),
    }),
  );
  if (caption !== undefined) {
    const capLines = wrapText(caption, CANVAS_W - 320, styleBible.typography.captionSizePx, false, 3);
    let cyy = ruleY + 52;
    for (const line of capLines.slice(0, 2)) {
      nodes.push(
        textNode(ctx, CANVAS_W / 2, cyy, line, {
          size: styleBible.typography.captionSizePx,
          fill: styleBible.palette.inkMuted.value,
          anchor: 'middle',
          spacing: 0.5,
        }),
      );
      cyy += styleBible.typography.captionSizePx * 1.4;
    }
  }
  return nodes;
}

// ---------------------------------------------------------------------------
// architecture / state diagrams
// ---------------------------------------------------------------------------

interface PlacedNode {
  readonly id: string;
  readonly label: string;
  readonly center: Point;
  readonly radius: number;
  readonly aiFlavored: boolean;
}

function diagramLayout(
  ctx: LayoutContext,
  variant: 'architecture' | 'state',
): { nodes: SvgNode[]; placed: Map<string, PlacedNode> } {
  const { spec, styleBible, trace } = ctx;
  const nodes: SvgNode[] = [frameChrome(ctx)];
  const diag = styleBible.diagram;
  const specNodes = spec.nodes;
  const placed = new Map<string, PlacedNode>();

  const hub =
    specNodes.length >= 3
      ? specNodes.reduce((best, node) => {
          const degree = spec.edges.filter(
            (edge) => edge.fromId === node.id || edge.toId === node.id,
          ).length;
          const bestDegree = spec.edges.filter(
            (edge) => edge.fromId === best.id || edge.toId === best.id,
          ).length;
          return degree > bestDegree ? node : best;
        }, specNodes[0] as (typeof specNodes)[number])
      : undefined;

  const cx = CANVAS_W / 2;
  const cy = CANVAS_H / 2 - 20;

  if (hub !== undefined && specNodes.length >= 3) {
    // Hub-and-spoke (center-weighted, radial — annotation motif).
    placed.set(hub.id, {
      id: hub.id,
      label: hub.label,
      center: { x: cx, y: cy },
      radius: 86,
      aiFlavored: hub.aiFlavored,
    });
    const spokes = specNodes.filter((node) => node.id !== hub.id).slice(0, 6);
    const ring = circlePoints(cx, cy, 250, spokes.length);
    spokes.forEach((node, i) => {
      const point = ring[i];
      if (point !== undefined) {
        placed.set(node.id, {
          id: node.id,
          label: node.label,
          center: point,
          radius: 64,
          aiFlavored: node.aiFlavored,
        });
      }
    });
  } else {
    // Even row, center-weighted.
    const count = Math.min(specNodes.length, 5);
    const slotWidth = (CANVAS_W - 2 * styleBible.layout.marginPx) / Math.max(1, count);
    specNodes.slice(0, 5).forEach((node, i) => {
      placed.set(node.id, {
        id: node.id,
        label: node.label,
        center: {
          x: styleBible.layout.marginPx + slotWidth * (i + 0.5),
          y: cy,
        },
        radius: 62,
        aiFlavored: node.aiFlavored,
      });
    });
  }

  // Edges first (under nodes), with arrowheads and predicate labels.
  for (const edge of spec.edges) {
    const from = placed.get(edge.fromId);
    const to = placed.get(edge.toId);
    if (from === undefined || to === undefined) {
      continue;
    }
    const seg = shortenSegment(from.center, to.center, from.radius + 8, to.radius + 14);
    const stroke = trackColor(trace, diag.edgeStroke);
    nodes.push(
      el('g', {}, [
        el('line', {
          x1: fmt(seg.from.x),
          y1: fmt(seg.from.y),
          x2: fmt(seg.to.x),
          y2: fmt(seg.to.y),
          stroke: stroke,
          'stroke-width': fmt(diag.edgeStrokeWidthPx),
          ...(diag.edgeDashPattern !== '' ? { 'stroke-dasharray': diag.edgeDashPattern } : {}),
        }),
        el('polygon', {
          points: arrowHeadPoints(seg.to, seg.from, 9),
          fill: stroke,
        }),
        el('text', {
          x: fmt((seg.from.x + seg.to.x) / 2),
          y: fmt((seg.from.y + seg.to.y) / 2 - 8),
          'font-family': `${styleBible.typography.labelFamily}, ui-sans-serif, system-ui, sans-serif`,
          'font-size': String(styleBible.typography.captionSizePx - 2),
          fill: trackColor(trace, styleBible.palette.inkMuted.value),
          'text-anchor': 'middle',
        }, [], truncateToWidth(edge.label, 150, styleBible.typography.captionSizePx - 2)),
      ]),
    );
  }

  // Nodes.
  for (const node of placed.values()) {
    const stroke = trackColor(
      trace,
      node.aiFlavored ? styleBible.palette.aiNode.value : diag.nodeStroke,
    );
    const fill = trackColor(trace, diag.nodeFill);
    const shape: SvgNode =
      variant === 'architecture' && diag.nodeShape === 'hexagon'
        ? el('polygon', {
            points: hexagonPoints(node.center.x, node.center.y, node.radius),
            fill,
            stroke,
            'stroke-width': fmt(diag.nodeStrokeWidthPx),
          })
        : el('rect', {
            x: fmt(node.center.x - node.radius),
            y: fmt(node.center.y - node.radius * 0.72),
            width: fmt(node.radius * 2),
            height: fmt(node.radius * 1.44),
            rx: '18',
            fill,
            stroke,
            'stroke-width': fmt(diag.nodeStrokeWidthPx),
          });
    const labelSize = styleBible.typography.labelSizePx - 4;
    const fit = fitTextLines(node.label, node.radius * 1.9, labelSize, 12, false, 2);
    const inside = fit.size >= 16 && fit.lines.length === 1;
    const labelNodes: SvgNode[] = inside
      ? [
          textNode(ctx, node.center.x, node.center.y + fit.size * 0.35, fit.lines[0] ?? node.label, {
            size: fit.size,
            fill: styleBible.palette.ink.value,
            weight: styleBible.typography.labelWeight,
            anchor: 'middle',
          }),
        ]
      : fit.lines.map((line, lineIndex) =>
          textNode(ctx, node.center.x, node.center.y + node.radius + 24 + lineIndex * (fit.size + 2), line, {
            size: fit.size,
            fill: styleBible.palette.ink.value,
            weight: styleBible.typography.labelWeight,
            anchor: 'middle',
          }),
        );
    markPlaced(ctx, node.label);
    nodes.push(el('g', {}, [shape, ...labelNodes]));
  }

  // Drafting tag (annotation motif: stencil labels like 'CIRCUIT # 22.2 B').
  nodes.push(
    textNode(ctx, styleBible.layout.marginPx + 14, 108, `FIG. ${stableHash(spec.seed) % 90 + 10}`, {
      size: styleBible.typography.captionSizePx - 2,
      fill: styleBible.palette.inkMuted.value,
      spacing: 2,
    }),
  );
  // Segmented timeline ruler (annotation motif, observed segment 9).
  const rulerY = CANVAS_H - 118;
  const rulerX = styleBible.layout.marginPx + 14;
  const rulerW = 240;
  for (let i = 0; i <= 12; i += 1) {
    const x = rulerX + (rulerW * i) / 12;
    const tick = i % 3 === 0 ? 10 : 5;
    nodes.push(
      el('line', {
        x1: fmt(x),
        y1: fmt(rulerY),
        x2: fmt(x),
        y2: fmt(rulerY + tick),
        stroke: trackColor(trace, styleBible.palette.emphasisSoft.value),
        'stroke-width': i % 3 === 0 ? '2' : '1',
      }),
    );
  }
  nodes.push(
    el('line', {
      x1: fmt(rulerX),
      y1: fmt(rulerY),
      x2: fmt(rulerX + rulerW),
      y2: fmt(rulerY),
      stroke: trackColor(trace, styleBible.palette.emphasisSoft.value),
      'stroke-width': '2',
    }),
  );

  // Caption strip (exact texts must all appear; remaining labels as chips).
  return { nodes, placed };
}

function arrowHeadPoints(tip: Point, from: Point, size: number): string {
  const angle = Math.atan2(tip.y - from.y, tip.x - from.x);
  const a1 = angle + Math.PI * 0.85;
  const a2 = angle - Math.PI * 0.85;
  const p1 = { x: tip.x + size * Math.cos(a1), y: tip.y + size * Math.sin(a1) };
  const p2 = { x: tip.x + size * Math.cos(a2), y: tip.y + size * Math.sin(a2) };
  return `${fmt(tip.x)},${fmt(tip.y)} ${fmt(p1.x)},${fmt(p1.y)} ${fmt(p2.x)},${fmt(p2.y)}`;
}

// ---------------------------------------------------------------------------
// process-flow
// ---------------------------------------------------------------------------

function layoutFlow(ctx: LayoutContext): SvgNode[] {
  const { spec, styleBible, trace } = ctx;
  const nodes: SvgNode[] = [frameChrome(ctx)];
  const steps = spec.steps.length > 0 ? spec.steps : spec.labels;
  const diag = styleBible.diagram;

  if (steps.length >= 5) {
    // Circular loop (annotation motif: dashed circular pathway, seg 27).
    const cx = CANVAS_W / 2;
    const cy = CANVAS_H / 2;
    const radius = 240;
    nodes.push(
      el('circle', {
        cx: fmt(cx),
        cy: fmt(cy),
        r: fmt(radius),
        fill: 'none',
        stroke: trackColor(trace, styleBible.palette.emphasisDeep.value),
        'stroke-width': '2',
        'stroke-dasharray': '10 8',
      }),
    );
    const points = circlePoints(cx, cy, radius, steps.length);
    steps.forEach((step, i) => {
      const point = points[i];
      if (point === undefined) {
        return;
      }
      const fit = fitTextLines(step, 220, styleBible.typography.labelSizePx - 6, 14, false, 2);
      const anchor =
        point.x > cx + 40 ? 'start' : point.x < cx - 40 ? 'end' : 'middle';
      const textX = point.x + (point.x > cx + 40 ? 46 : point.x < cx - 40 ? -46 : 0);
      const textY = point.y + (point.y > cy ? 34 : -22);
      markPlaced(ctx, step);
      nodes.push(
        el('g', {}, [
          el('circle', {
            cx: fmt(point.x),
            cy: fmt(point.y),
            r: '16',
            fill: trackColor(trace, diag.nodeFill),
            stroke: trackColor(trace, diag.nodeStroke),
            'stroke-width': fmt(diag.nodeStrokeWidthPx),
          }),
          textNode(ctx, point.x, point.y + 6, String(i + 1), {
            size: styleBible.typography.captionSizePx,
            fill: styleBible.palette.ink.value,
            weight: styleBible.typography.labelWeight,
            anchor: 'middle',
          }),
          ...fit.lines.map((line, lineIndex) =>
            textNode(ctx, textX, textY + lineIndex * (fit.size + 2), `${i + 1}. ${line}`, {
              size: fit.size,
              fill: styleBible.palette.ink.value,
              anchor: anchor as 'start' | 'middle' | 'end',
            }),
          ),
        ]),
      );
    });
  } else {
    // Horizontal chain.
    const count = Math.max(1, steps.length);
    const usable = CANVAS_W - 2 * styleBible.layout.marginPx;
    const slot = usable / count;
    const boxW = Math.min(200, slot - 28);
    const y = CANVAS_H / 2 - 20;
    steps.forEach((step, i) => {
      const x = styleBible.layout.marginPx + slot * (i + 0.5);
      const labelSize = styleBible.typography.labelSizePx - 6;
      markPlaced(ctx, step);
      nodes.push(
        el('g', {}, [
          el('rect', {
            x: fmt(x - boxW / 2),
            y: fmt(y - 54),
            width: fmt(boxW),
            height: '108',
            rx: '14',
            fill: trackColor(trace, diag.nodeFill),
            stroke: trackColor(trace, diag.nodeStroke),
            'stroke-width': fmt(diag.nodeStrokeWidthPx),
          }),
          textNode(ctx, x, y - 18, String(i + 1), {
            size: styleBible.typography.captionSizePx + 2,
            fill: trackColor(trace, styleBible.palette.emphasis.value),
            weight: styleBible.typography.labelWeight,
            anchor: 'middle',
          }),
          ...fitTextLines(step, boxW - 24, labelSize, 12, false, 2).lines.map((line, lineIndex) =>
            textNode(ctx, x, y + 22 + lineIndex * (labelSize - 4), line, {
              size: labelSize,
              fill: styleBible.palette.ink.value,
              anchor: 'middle',
            }),
          ),
        ]),
      );
      if (i < count - 1) {
        const nextX = styleBible.layout.marginPx + slot * (i + 1.5);
        const tip = { x: nextX - boxW / 2 - 10, y };
        const from = { x: x + boxW / 2 + 10, y };
        nodes.push(
          el('polygon', {
            points: arrowHeadPoints(tip, from, 10),
            fill: trackColor(trace, diag.edgeStroke),
          }),
        );
        nodes.push(
          el('line', {
            x1: fmt(from.x),
            y1: fmt(from.y),
            x2: fmt(tip.x - 2),
            y2: fmt(tip.y),
            stroke: trackColor(trace, diag.edgeStroke),
            'stroke-width': fmt(diag.edgeStrokeWidthPx),
          }),
        );
      }
    });
  }
  return nodes;
}

// ---------------------------------------------------------------------------
// data-chart
// ---------------------------------------------------------------------------

function layoutChart(ctx: LayoutContext): SvgNode[] {
  const { spec, styleBible, trace } = ctx;
  const nodes: SvgNode[] = [frameChrome(ctx)];
  const bars = spec.chartBars.length > 0 ? spec.chartBars : [];
  const chartX = styleBible.layout.marginPx + 40;
  const chartY = 150;
  const chartW = CANVAS_W - 2 * (styleBible.layout.marginPx + 40);
  const chartH = CANVAS_H - chartY - 150;
  const maxValue = Math.max(1, ...bars.map((bar) => bar.value));

  // Gridlines.
  for (let i = 0; i <= 4; i += 1) {
    const y = chartY + (chartH * i) / 4;
    nodes.push(
      el('line', {
        x1: fmt(chartX),
        y1: fmt(y),
        x2: fmt(chartX + chartW),
        y2: fmt(y),
        stroke: trackColor(trace, styleBible.palette.surface.value),
        'stroke-width': '1',
        opacity: '0.5',
      }),
    );
  }

  const slot = chartW / Math.max(1, bars.length);
  const barW = Math.min(90, slot * 0.55);
  bars.forEach((bar, i) => {
    const x = chartX + slot * (i + 0.5);
    const h = (chartH * bar.value) / maxValue;
    nodes.push(
      el('rect', {
        x: fmt(x - barW / 2),
        y: fmt(chartY + chartH - h),
        width: fmt(barW),
        height: fmt(h),
        rx: '4',
        fill: trackColor(trace, styleBible.palette.emphasisDeep.value),
        stroke: trackColor(trace, styleBible.palette.emphasis.value),
        'stroke-width': '1.5',
      }),
    );
    const labelSize = styleBible.typography.captionSizePx;
    const barFit = fitTextLines(bar.label, Math.max(80, slot - 14), labelSize, 12, false, 2);
    barFit.lines.forEach((line, lineIndex) => {
      nodes.push(
        textNode(ctx, x, chartY + chartH + 28 + lineIndex * (barFit.size + 2), line, {
          size: barFit.size,
          fill: styleBible.palette.inkMuted.value,
          anchor: 'middle',
        }),
      );
    });
    markPlaced(ctx, bar.label);
    nodes.push(
      textNode(ctx, x, chartY + chartH - h - 10, String(bar.value), {
        size: labelSize,
        fill: styleBible.palette.ink.value,
        weight: styleBible.typography.labelWeight,
        anchor: 'middle',
      }),
    );
  });
  return nodes;
}

// ---------------------------------------------------------------------------
// code-panel
// ---------------------------------------------------------------------------

const CODE_KEYWORDS = new Set([
  'const',
  'let',
  'var',
  'function',
  'return',
  'if',
  'else',
  'for',
  'while',
  'await',
  'async',
  'import',
  'export',
  'from',
  'true',
  'false',
  'null',
  'new',
]);

function layoutCode(ctx: LayoutContext): SvgNode[] {
  const { spec, styleBible, trace } = ctx;
  const nodes: SvgNode[] = [frameChrome(ctx)];
  const panelX = 180;
  const panelY = 90;
  const panelW = CANVAS_W - 2 * 180;
  const panelH = CANVAS_H - 2 * 90;
  nodes.push(
    el('rect', {
      x: fmt(panelX),
      y: fmt(panelY),
      width: fmt(panelW),
      height: fmt(panelH),
      rx: '14',
      fill: trackColor(trace, styleBible.palette.backgroundDeep.value),
      stroke: trackColor(trace, styleBible.palette.emphasisSoft.value),
      'stroke-width': '1.5',
    }),
  );
  // Window dots (annotation motif: hand-drawn editor chrome).
  for (let i = 0; i < 3; i += 1) {
    nodes.push(
      el('circle', {
        cx: fmt(panelX + 26 + i * 24),
        cy: fmt(panelY + 26),
        r: '6',
        fill: trackColor(
          trace,
          i === 0
            ? styleBible.palette.warning.value
            : i === 1
              ? styleBible.palette.accentWarm.value
              : styleBible.palette.accentGreen.value,
        ),
      }),
    );
  }
  const codeSize = styleBible.typography.codeSizePx;
  const lineH = codeSize * 1.55;
  const lines = spec.codeLines.length > 0 ? spec.codeLines : spec.labels;
  for (const line of lines) {
    markPlaced(ctx, line);
  }
  const maxLines = Math.floor((panelH - 90) / lineH);
  lines.slice(0, maxLines).forEach((line, i) => {
    const y = panelY + 70 + i * lineH;
    const x = panelX + 34;
    if (line.startsWith('//')) {
      nodes.push(
        textNode(ctx, x, y, truncateToWidth(line, panelW - 68, codeSize, true), {
          size: codeSize,
          fill: styleBible.palette.inkMuted.value,
          mono: true,
        }),
      );
      return;
    }
    // Deterministic lightweight token coloring.
    const tokens = line.split(/(\s+|[(),;:{}[\]])/);
    let tx = x;
    for (const token of tokens) {
      if (token === undefined || token === '') {
        continue;
      }
      const isString = token.startsWith('"') || token.endsWith('"');
      const fill = isString
        ? styleBible.palette.accentGreen.value
        : CODE_KEYWORDS.has(token)
          ? styleBible.palette.emphasis.value
          : styleBible.palette.ink.value;
      if (!/^\s+$/.test(token)) {
        nodes.push(
          textNode(ctx, tx, y, token, { size: codeSize, fill, mono: true }),
        );
      }
      tx += measureText(token, codeSize, true);
    }
  });
  return nodes;
}

// ---------------------------------------------------------------------------
// quote-panel
// ---------------------------------------------------------------------------

function layoutQuote(ctx: LayoutContext): SvgNode[] {
  const { spec, styleBible } = ctx;
  const nodes: SvgNode[] = [frameChrome(ctx)];
  const quote = spec.quote ?? spec.labels[0] ?? '';
  markPlaced(ctx, quote);
  markPlaced(ctx, spec.caption);
  markPlaced(ctx, spec.labels[spec.labels.length - 1]);
  const quoteSize = Math.round(styleBible.typography.headingSizePx * 0.8);
  const lines = wrapText(quote, CANVAS_W - 400, quoteSize, false, 6);
  let y = CANVAS_H / 2 - (lines.length - 1) * (quoteSize * 0.7) - 20;
  nodes.push(
    textNode(ctx, 250, y - quoteSize, '“', {
      size: quoteSize * 2.4,
      fill: styleBible.palette.emphasis.value,
      weight: 700,
    }),
  );
  for (const line of lines) {
    nodes.push(
      textNode(ctx, CANVAS_W / 2, y, line, {
        size: quoteSize,
        fill: styleBible.palette.ink.value,
        anchor: 'middle',
        italic: true,
      }),
    );
    y += quoteSize * 1.4;
  }
  const source = spec.caption ?? spec.labels[spec.labels.length - 1];
  if (source !== undefined) {
    nodes.push(
      textNode(ctx, CANVAS_W / 2, y + 26, `— ${truncateToWidth(source, 600, styleBible.typography.captionSizePx)}`, {
        size: styleBible.typography.captionSizePx,
        fill: styleBible.palette.inkMuted.value,
        anchor: 'middle',
      }),
    );
  }
  return nodes;
}

// ---------------------------------------------------------------------------
// callout
// ---------------------------------------------------------------------------

function layoutCallout(ctx: LayoutContext): SvgNode[] {
  const { spec, styleBible, trace } = ctx;
  const nodes: SvgNode[] = [frameChrome(ctx)];
  const cardW = 720;
  const cardH = 380;
  const x = (CANVAS_W - cardW) / 2;
  const y = (CANVAS_H - cardH) / 2;
  nodes.push(
    el('rect', {
      x: fmt(x),
      y: fmt(y),
      width: fmt(cardW),
      height: fmt(cardH),
      rx: '16',
      fill: trackColor(trace, styleBible.palette.surface.value),
      stroke: trackColor(trace, styleBible.palette.emphasis.value),
      'stroke-width': '2',
    }),
  );
  nodes.push(
    el('rect', {
      x: fmt(x),
      y: fmt(y),
      width: '10',
      height: fmt(cardH),
      rx: '5',
      fill: trackColor(trace, styleBible.palette.emphasis.value),
    }),
  );
  const title = spec.labels[0] ?? spec.title ?? 'CALLOUT';
  markPlaced(ctx, title);
  const titleFit = fitTextLines(title, cardW - 96, styleBible.typography.headingSizePx, 24, false, 2);
  titleFit.lines.forEach((line, index) => {
    nodes.push(
      textNode(ctx, x + 48, y + 86 + index * (titleFit.size + 4), line, {
        size: titleFit.size,
        fill: styleBible.palette.ink.value,
        weight: styleBible.typography.titleWeight,
      }),
    );
  });
  // Body carries ALL remaining labels plus the caption, verbatim.
  const bodyParts = [
    ...spec.labels.slice(1),
    ...(spec.caption !== undefined && spec.caption !== title ? [spec.caption] : []),
  ];
  markPlaced(ctx, spec.caption);
  for (const part of spec.labels.slice(1)) {
    markPlaced(ctx, part);
  }
  const bodySize = styleBible.typography.labelSizePx;
  let by = y + 150 + (titleFit.lines.length - 1) * (titleFit.size + 4);
  for (const part of bodyParts) {
    const fit = fitTextLines(part, cardW - 96, bodySize, 14, false, 2);
    for (const line of fit.lines) {
      nodes.push(
        textNode(ctx, x + 48, by, line, {
          size: fit.size,
          fill: styleBible.palette.inkMuted.value,
        }),
      );
      by += fit.size * 1.45;
    }
  }
  return nodes;
}

// ---------------------------------------------------------------------------
// table
// ---------------------------------------------------------------------------

function layoutTable(ctx: LayoutContext): SvgNode[] {
  const { spec, styleBible, trace } = ctx;
  const nodes: SvgNode[] = [frameChrome(ctx)];
  const rows =
    spec.rows.length > 0
      ? spec.rows
      : spec.labels.map((label) => [label, '']);
  const tableX = styleBible.layout.marginPx + 60;
  const tableW = CANVAS_W - 2 * (styleBible.layout.marginPx + 60);
  const headerY = 170;
  const rowH = 64;
  const shown = rows.slice(0, 6);
  const col1 = tableW * 0.62;

  nodes.push(
    textNode(ctx, tableX, headerY - 36, 'NAME', {
      size: styleBible.typography.captionSizePx,
      fill: styleBible.palette.emphasis.value,
      weight: styleBible.typography.labelWeight,
      spacing: 2,
    }),
  );
  nodes.push(
    textNode(ctx, tableX + col1 + 24, headerY - 36, 'KIND', {
      size: styleBible.typography.captionSizePx,
      fill: styleBible.palette.emphasis.value,
      weight: styleBible.typography.labelWeight,
      spacing: 2,
    }),
  );
  nodes.push(
    el('line', {
      x1: fmt(tableX),
      y1: fmt(headerY - 20),
      x2: fmt(tableX + tableW),
      y2: fmt(headerY - 20),
      stroke: trackColor(trace, styleBible.palette.emphasis.value),
      'stroke-width': '2',
    }),
  );
  shown.forEach((row, i) => {
    const y = headerY + i * rowH;
    if (i % 2 === 1) {
      nodes.push(
        el('rect', {
          x: fmt(tableX - 10),
          y: fmt(y - 2),
          width: fmt(tableW + 20),
          height: fmt(rowH - 8),
          rx: '6',
          fill: trackColor(trace, styleBible.palette.backgroundDeep.value),
          opacity: '0.55',
        }),
      );
    }
    const labelSize = styleBible.typography.labelSizePx - 2;
    markPlaced(ctx, row[0]);
    nodes.push(
      textNode(ctx, tableX, y + 34, truncateToWidth(row[0] ?? '', col1 - 20, labelSize), {
        size: labelSize,
        fill: styleBible.palette.ink.value,
      }),
    );
    nodes.push(
      textNode(
        ctx,
        tableX + col1 + 24,
        y + 34,
        truncateToWidth(labelize(ctx, row[1] ?? ''), tableW - col1 - 40, labelSize),
        {
          size: labelSize,
          fill: styleBible.palette.inkMuted.value,
        },
      ),
    );
  });
  return nodes;
}

// ---------------------------------------------------------------------------
// illustration-grounded layouts
// ---------------------------------------------------------------------------

/**
 * Guaranteed exact-text ledger: every spec text (labels, caption) not
 * already placed verbatim by the primary layout renders in a wrapped
 * caption strip above the bottom margin. Deterministic font shrinking keeps
 * any number of texts inside at most 3 rows — the contract requirement
 * (exact texts must appear) always holds.
 */
export function placeRemainingTexts(ctx: LayoutContext, nodes: SvgNode[]): void {
  const { styleBible } = ctx;
  const remaining = ctx.spec.labels.filter((label) => !ctx.placed.has(label));
  const caption =
    ctx.spec.caption !== undefined && !ctx.placed.has(ctx.spec.caption)
      ? ctx.spec.caption
      : undefined;
  if (remaining.length === 0 && caption === undefined) {
    return;
  }
  const parts = [...new Set(caption !== undefined ? [caption, ...remaining] : [...remaining])];
  const maxWidth = CANVAS_W - 2 * (styleBible.layout.marginPx + 14);
  for (let size = styleBible.typography.captionSizePx; size >= 12; size -= 2) {
    const lines: string[] = [];
    let line = '';
    for (const part of parts) {
      const candidate = line === '' ? part : `${line}  ·  ${part}`;
      if (measureText(candidate, size) <= maxWidth) {
        line = candidate;
      } else {
        if (line !== '') {
          lines.push(line);
        }
        line = part;
      }
    }
    if (line !== '') {
      lines.push(line);
    }
    if (lines.length <= 3) {
      const rowH = size + 8;
      const baseY = CANVAS_H - styleBible.layout.marginPx + 26 - (lines.length - 1) * rowH;
      const group: SvgNode[] = [
        el('rect', {
          x: fmt(styleBible.layout.marginPx + 6),
          y: fmt(baseY - size - 2),
          width: '3',
          height: fmt(lines.length * rowH - 6),
          rx: '1.5',
          fill: trackColor(ctx.trace, styleBible.palette.emphasisSoft.value),
        }),
      ];
      lines.forEach((lineText, index) => {
        group.push(
          textNode(ctx, styleBible.layout.marginPx + 22, baseY + index * rowH, lineText, {
            size,
            fill: styleBible.palette.inkMuted.value,
          }),
        );
      });
      nodes.push(el('g', {}, group));
      return;
    }
  }
}

function layoutIllustration(ctx: LayoutContext, overlay: boolean): SvgNode[] {
  const nodes: SvgNode[] = [];
  if (ctx.illustration !== undefined) {
    nodes.push(illustrationLayer(ctx));
  }
  if (overlay) {
    nodes.push(frameChrome(ctx));
  }
  return nodes;
}

function layoutWorkstation(ctx: LayoutContext): SvgNode[] {
  // Hybrid: illustration environment + crisp deterministic monitor panels.
  const { spec, styleBible, trace } = ctx;
  const nodes: SvgNode[] = [frameChrome(ctx)];
  if (ctx.illustration !== undefined) {
    nodes.push(illustrationLayer(ctx, 0.9));
  }
  const panelW = 300;
  const panelH = 170;
  const gap = 40;
  const totalW = 2 * panelW + gap;
  const startX = (CANVAS_W - totalW) / 2;
  const y = CANVAS_H / 2 - panelH / 2;
  for (let i = 0; i < 2; i += 1) {
    const x = startX + i * (panelW + gap);
    nodes.push(
      el('rect', {
        x: fmt(x),
        y: fmt(y),
        width: fmt(panelW),
        height: fmt(panelH),
        rx: '10',
        fill: trackColor(trace, styleBible.palette.backgroundDeep.value),
        stroke: trackColor(trace, styleBible.palette.emphasisSoft.value),
        'stroke-width': '2',
        opacity: '0.92',
      }),
    );
    const header = spec.labels[i] ?? (i === 0 ? 'PANEL A' : 'PANEL B');
    markPlaced(ctx, spec.labels[i]);
    nodes.push(
      textNode(ctx, x + 18, y + 34, truncateToWidth(header, panelW - 36, styleBible.typography.captionSizePx + 2), {
        size: styleBible.typography.captionSizePx + 2,
        fill: styleBible.palette.emphasis.value,
        weight: styleBible.typography.labelWeight,
        spacing: 1,
      }),
    );
    // Deterministic mini bar chart inside each panel (grounded bars if any).
    const bars = spec.chartBars.slice(i * 3, i * 3 + 3);
    const source =
      bars.length > 0
        ? bars
        : [
            { label: 'a', value: 3 },
            { label: 'b', value: 5 },
            { label: 'c', value: 2 },
          ];
    const maxValue = Math.max(1, ...source.map((bar) => bar.value));
    source.forEach((bar, j) => {
      const barH = (90 * bar.value) / maxValue;
      const bx = x + 34 + j * ((panelW - 68) / Math.max(1, source.length));
      nodes.push(
        el('rect', {
          x: fmt(bx),
          y: fmt(y + panelH - 26 - barH),
          width: '26',
          height: fmt(barH),
          rx: '3',
          fill: trackColor(trace, styleBible.palette.emphasisDeep.value),
        }),
      );
    });
  }
  // Grounded entity roster: the reference dashboards list their stack
  // components; every grounded entity name lands verbatim (grounding trace).
  const roster = spec.nodes.map((node) => node.label).filter((label) => label !== '');
  if (roster.length > 0) {
    const rosterSize = styleBible.typography.captionSizePx - 2;
    const rosterFit = fitTextLines(
      roster.join('  ·  '),
      CANVAS_W - 2 * (styleBible.layout.marginPx + 20),
      rosterSize,
      12,
      false,
      2,
    );
    nodes.push(
      textNode(ctx, styleBible.layout.marginPx + 20, y + panelH + 44, 'STACK', {
        size: rosterSize,
        fill: styleBible.palette.emphasis.value,
        weight: styleBible.typography.labelWeight,
        spacing: 2,
      }),
    );
    rosterFit.lines.forEach((line, index) => {
      nodes.push(
        textNode(ctx, styleBible.layout.marginPx + 20, y + panelH + 70 + index * (rosterFit.size + 4), line, {
          size: rosterFit.size,
          fill: styleBible.palette.inkMuted.value,
        }),
      );
    });
  }
  return nodes;
}

function layoutMontage(ctx: LayoutContext): SvgNode[] {
  const { spec, styleBible, trace } = ctx;
  const nodes: SvgNode[] = [frameChrome(ctx)];
  // 2x2 grid of framed tiles; the illustration fragment (when present) is
  // stretched full-bleed under dimmed tiles (single-provider constraint).
  if (ctx.illustration !== undefined) {
    nodes.push(illustrationLayer(ctx, 0.5));
  }
  const gridX = 160;
  const gridY = 110;
  const tileW = (CANVAS_W - 2 * gridX - 30) / 2;
  const tileH = (CANVAS_H - 2 * gridY - 30) / 2;
  for (let i = 0; i < 4; i += 1) {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = gridX + col * (tileW + 30);
    const y = gridY + row * (tileH + 30);
    nodes.push(
      el('rect', {
        x: fmt(x),
        y: fmt(y),
        width: fmt(tileW),
        height: fmt(tileH),
        rx: '12',
        fill: trackColor(trace, styleBible.palette.backgroundDeep.value),
        stroke: trackColor(trace, styleBible.palette.emphasisSoft.value),
        'stroke-width': '2',
      }),
    );
    const label = spec.labels[i];
    if (label !== undefined) {
      markPlaced(ctx, label);
      nodes.push(
        textNode(ctx, x + 22, y + tileH - 22, truncateToWidth(label, tileW - 44, styleBible.typography.captionSizePx), {
          size: styleBible.typography.captionSizePx,
          fill: styleBible.palette.ink.value,
          weight: styleBible.typography.labelWeight,
        }),
      );
    }
  }
  return nodes;
}

// ---------------------------------------------------------------------------
// dispatch
// ---------------------------------------------------------------------------

/** Build the frame content for one render spec. Pure and deterministic. */
export function layoutFrame(ctx: LayoutContext): SvgNode[] {
  const nodes = layoutFrameInner(ctx);
  // Universal guarantee: every exact text lands in the frame.
  placeRemainingTexts(ctx, nodes);
  return nodes;
}

function layoutFrameInner(ctx: LayoutContext): SvgNode[] {
  switch (ctx.spec.visualType) {
    case 'title-card':
      return layoutTitle(ctx);
    case 'architecture-diagram':
      return diagramLayout(ctx, 'architecture').nodes;
    case 'state-diagram':
      return diagramLayout(ctx, 'state').nodes;
    case 'process-flow':
      return layoutFlow(ctx);
    case 'data-chart':
      return layoutChart(ctx);
    case 'code-panel':
      return layoutCode(ctx);
    case 'quote-panel':
      return layoutQuote(ctx);
    case 'callout':
      return layoutCallout(ctx);
    case 'table':
      return layoutTable(ctx);
    case 'workstation-scene':
      return layoutWorkstation(ctx);
    case 'montage':
      return layoutMontage(ctx);
    case 'hero-illustration':
    case 'metaphor-illustration':
    default:
      return layoutIllustration(ctx, ctx.spec.labels.length > 0);
  }
}

export { CANVAS_W, CANVAS_H };
