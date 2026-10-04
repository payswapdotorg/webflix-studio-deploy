/**
 * Video pipeline (WFLX-W3) — deterministic SVG primitives.
 *
 * Every helper here is a pure function with stable output ordering and fixed
 * number formatting, so identical inputs produce byte-identical SVG (the
 * Phase 2B determinism requirement). No Math.random, no Date, no locale
 * formatting, no external image services.
 */

/** XML-escape a text value for safe embedding. */
export function esc(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

/** Fixed 2-decimal plain formatting (never exponent notation). */
export function fmt(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  const fixed = rounded.toFixed(2);
  return fixed.replace(/\.?0+$/, '') || '0';
}

export type SvgNode = {
  readonly name: string;
  readonly attrs: Readonly<Record<string, string>>;
  readonly children: readonly SvgNode[];
  readonly text?: string;
};

/** Build an SVG element node (attribute order is insertion order — stable). */
export function el(
  name: string,
  attrs: Readonly<Record<string, string>> = {},
  children: readonly SvgNode[] = [],
  text?: string,
): SvgNode {
  return { name, attrs, children, ...(text !== undefined ? { text } : {}) };
}

/** Serialize a node tree to an SVG document string. */
export function serialize(node: SvgNode): string {
  const attrs = Object.entries(node.attrs)
    .map(([key, value]) => ` ${key}="${esc(value)}"`)
    .join('');
  if (node.children.length === 0 && node.text === undefined) {
    return `<${node.name}${attrs}/>`;
  }
  const inner = node.children.map(serialize).join('');
  return `<${node.name}${attrs}>${node.text !== undefined ? esc(node.text) : ''}${inner}</${node.name}>`;
}

// ---------------------------------------------------------------------------
// Deterministic text measurement (no DOM; approximation tables)
// ---------------------------------------------------------------------------

const NARROW_CHARS = new Set('ijltfrI.,:;\'!|()[] '.split(''));
const WIDE_CHARS = new Set('mwMW@'.split(''));

function charAdvance(ch: string, isMono: boolean, sizePx: number): number {
  if (isMono) {
    return sizePx * 0.6;
  }
  if (NARROW_CHARS.has(ch)) {
    return sizePx * 0.3;
  }
  if (WIDE_CHARS.has(ch)) {
    return sizePx * 0.92;
  }
  if (ch >= 'A' && ch <= 'Z') {
    return sizePx * 0.72;
  }
  if (ch >= '0' && ch <= '9') {
    return sizePx * 0.58;
  }
  return sizePx * 0.55;
}

/** Approximate rendered width of a single-line string in pixels. */
export function measureText(text: string, sizePx: number, isMono = false): number {
  let width = 0;
  for (const ch of text) {
    width += charAdvance(ch, isMono, sizePx);
  }
  return width;
}

/** Greedy word wrap to a maximum pixel width. Returns wrapped lines. */
export function wrapText(
  text: string,
  maxWidthPx: number,
  sizePx: number,
  isMono = false,
  maxLines = 6,
): string[] {
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current === '' ? word : `${current} ${word}`;
    if (measureText(candidate, sizePx, isMono) <= maxWidthPx || current === '') {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
      if (lines.length === maxLines) {
        break;
      }
    }
  }
  if (current !== '' && lines.length < maxLines) {
    lines.push(current);
  }
  if (lines.length === maxLines) {
    const last = lines[maxLines - 1];
    // Ellipsize ONLY when a single word alone cannot fit (hard cap);
    // a line that merely reached the row cap must not lose text.
    if (
      last !== undefined &&
      !last.includes(' ') &&
      measureText(last, sizePx, isMono) > maxWidthPx
    ) {
      let trimmed = last;
      while (
        trimmed.length > 1 &&
        measureText(`${trimmed}…`, sizePx, isMono) > maxWidthPx
      ) {
        trimmed = trimmed.slice(0, -1);
      }
      lines[maxLines - 1] = `${trimmed}…`;
    }
  }
  return lines;
}

/** Deterministic truncation with ellipsis to a pixel width. */
export function truncateToWidth(
  text: string,
  maxWidthPx: number,
  sizePx: number,
  isMono = false,
): string {
  if (measureText(text, sizePx, isMono) <= maxWidthPx) {
    return text;
  }
  let trimmed = text;
  while (trimmed.length > 1 && measureText(`${trimmed}…`, sizePx, isMono) > maxWidthPx) {
    trimmed = trimmed.slice(0, -1);
  }
  return `${trimmed}…`;
}

// ---------------------------------------------------------------------------
// Geometry helpers (stable path math)
// ---------------------------------------------------------------------------

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Hexagon path points centered at (cx, cy) with circumradius r. */
export function hexagonPoints(cx: number, cy: number, r: number): string {
  const points: string[] = [];
  for (let i = 0; i < 6; i += 1) {
    const angle = (Math.PI / 3) * i - Math.PI / 6;
    const x = cx + r * Math.cos(angle);
    const y = cy + r * Math.sin(angle);
    points.push(`${fmt(x)},${fmt(y)}`);
  }
  return points.join(' ');
}

/** Points evenly spaced on a circle (clockwise from the top). */
export function circlePoints(
  cx: number,
  cy: number,
  radius: number,
  count: number,
  startAngle = -Math.PI / 2,
): Point[] {
  const points: Point[] = [];
  for (let i = 0; i < count; i += 1) {
    const angle = startAngle + (2 * Math.PI * i) / Math.max(1, count);
    points.push({ x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) });
  }
  return points;
}

/** Shorten a segment on both ends (so arrows meet node borders, not centers). */
export function shortenSegment(
  from: Point,
  to: Point,
  trimStart: number,
  trimEnd: number,
): { from: Point; to: Point } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) {
    return { from, to };
  }
  const ux = dx / len;
  const uy = dy / len;
  return {
    from: { x: from.x + ux * trimStart, y: from.y + uy * trimStart },
    to: { x: to.x - ux * trimEnd, y: to.y - uy * trimEnd },
  };
}

/** Deterministic string hash to derive stable hues (for accents). */
export function stableHash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Whitespace-insensitive text containment for QA: strips markup (tags become
 * spaces), collapses whitespace, then checks substring presence. Handles
 * exact texts that layouts wrap across multiple <text> lines — the text is
 * present verbatim even when split across elements.
 */
export function svgContainsText(svg: string, value: string): boolean {
  const flatten = (input: string): string =>
    input
      .replace(/<[^>]*>/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  return flatten(svg).includes(flatten(value));
}
