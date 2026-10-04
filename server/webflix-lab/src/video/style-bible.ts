/**
 * Video pipeline (WFLX-W3) — the StyleBible.
 *
 * Worker-owned, versioned like CONTRACTS_VERSION (src/contracts/primitives.ts):
 * the distilled visual grammar of the golden reference video, derived from
 * the committed full-duration annotation (reference/annotations/). Every
 * field cites its evidence; palette hexes are representative values distilled
 * from the annotation's quantized pixel buckets and vision-model observations
 * (AGENTS.md labels: OBSERVED for reference-derived facts).
 *
 * The StyleBible is NOT a shared W1 contract: plans reference it by id
 * (PlanStyle.styleBibleId / VideoScene.styleBibleId, "Worker 3 namespace"),
 * and this module is the single source of truth for its shape. The canonical
 * instance `REFERENCE_INK` carries the id the canonical plan fixture already
 * cites: 'style-bible--reference-ink'.
 *
 * Versioning: bump STYLE_BIBLE_VERSION when the grammar changes; the guard
 * accepts the same major only (mirrors the contracts discipline).
 */

import { z } from 'zod';
import { IdSchema, SemVerSchema } from '../contracts/primitives';

/** Version of the StyleBible bundle. Bump per AGENTS.md drift controls. */
export const STYLE_BIBLE_VERSION = '1.0.0' as const;

const STYLE_BIBLE_MAJOR = STYLE_BIBLE_VERSION.split('.')[0] as string;

const HexColorSchema = z
  .string()
  .regex(/^#[0-9a-f]{6}$/)
  .describe('Lowercase 6-digit hex color.');

const FontFamilySchema = z.enum(['sans-serif', 'monospace']).describe(
  'Generic font family (system fonts; no font files are embedded, keeping ' +
    'rendering deterministic across environments).',
);

/** Where a palette value comes from — evidence discipline for every hex. */
export const PaletteEvidenceSchema = z
  .object({
    value: HexColorSchema,
    evidence: z.string().min(1).max(500),
  })
  .describe('One palette role with its derivation evidence.');

export type PaletteEvidence = z.infer<typeof PaletteEvidenceSchema>;

export const StyleBiblePaletteSchema = z
  .strictObject({
    background: PaletteEvidenceSchema,
    backgroundDeep: PaletteEvidenceSchema,
    surface: PaletteEvidenceSchema,
    surfaceAlt: PaletteEvidenceSchema,
    paper: PaletteEvidenceSchema,
    paperAlt: PaletteEvidenceSchema,
    ink: PaletteEvidenceSchema,
    inkMuted: PaletteEvidenceSchema,
    emphasis: PaletteEvidenceSchema,
    emphasisDeep: PaletteEvidenceSchema,
    emphasisSoft: PaletteEvidenceSchema,
    warning: PaletteEvidenceSchema,
    accentWarm: PaletteEvidenceSchema,
    accentGreen: PaletteEvidenceSchema,
    aiNode: PaletteEvidenceSchema,
  })
  .meta({ id: 'StyleBiblePalette', title: 'StyleBiblePalette' })
  .describe('Named color roles of the visual grammar.');

export type StyleBiblePalette = z.infer<typeof StyleBiblePaletteSchema>;

export const StyleBibleTypographySchema = z
  .strictObject({
    labelFamily: FontFamilySchema,
    codeFamily: FontFamilySchema,
    titleSizePx: z.number().int().min(24).max(200),
    headingSizePx: z.number().int().min(18).max(120),
    labelSizePx: z.number().int().min(12).max(72),
    captionSizePx: z.number().int().min(10).max(48),
    codeSizePx: z.number().int().min(10).max(48),
    labelCase: z.enum(['upper', 'title', 'sentence']).describe(
      'Observed reference convention: ALL-CAPS for headers and labels.',
    ),
    titleWeight: z.number().int().min(100).max(900),
    labelWeight: z.number().int().min(100).max(900),
  })
  .meta({ id: 'StyleBibleTypography', title: 'StyleBibleTypography' })
  .describe('Typography system.');

export type StyleBibleTypography = z.infer<typeof StyleBibleTypographySchema>;

export const StyleBibleLayoutSchema = z
  .strictObject({
    widthPx: z.number().int().min(16).max(4096),
    heightPx: z.number().int().min(16).max(4096),
    marginPx: z.number().int().min(0).max(400),
    gutterPx: z.number().int().min(0).max(200),
    composition: z.enum(['center-weighted', 'grid', 'split', 'radial']),
  })
  .meta({ id: 'StyleBibleLayout', title: 'StyleBibleLayout' })
  .describe('Canvas and composition grammar.');

export type StyleBibleLayout = z.infer<typeof StyleBibleLayoutSchema>;

export const StyleBibleDiagramSchema = z
  .strictObject({
    nodeShape: z.enum(['hexagon', 'rounded-rect', 'circle', 'cylinder']),
    nodeFill: HexColorSchema,
    nodeStroke: HexColorSchema,
    nodeStrokeWidthPx: z.number().positive().max(12),
    edgeStroke: HexColorSchema,
    edgeStrokeWidthPx: z.number().positive().max(12),
    edgeDashPattern: z
      .string()
      .regex(/^(\d+(,\d+)*)?$/)
      .describe('SVG stroke-dasharray; empty string = solid.'),
    arrowhead: z.enum(['triangle', 'chevron', 'none']),
    loopStyle: z.enum(['dashed-circle', 'rounded-rect-chain', 'none']),
  })
  .meta({ id: 'StyleBibleDiagram', title: 'StyleBibleDiagram' })
  .describe('Diagram primitives grammar (nodes, edges, loops).');

export type StyleBibleDiagram = z.infer<typeof StyleBibleDiagramSchema>;

export const StyleBibleMotionSchema = z
  .strictObject({
    defaultMotion: z.enum(['static', 'pan', 'zoom', 'parallax', 'animated-diagram']),
    allowedMotions: z.array(z.enum(['static', 'pan', 'zoom', 'parallax', 'animated-diagram'])).min(1),
    preferredTransition: z.enum(['cut', 'crossfade', 'wipe', 'push', 'morph']),
    crossfadeShare: z
      .number()
      .min(0)
      .max(1)
      .describe('Observed share of crossfades among scene transitions.'),
    hardCutShare: z.number().min(0).max(1),
    transitionSeconds: z
      .number()
      .positive()
      .max(2)
      .describe('Crossfade ramp duration in seconds (observed ~0.2-0.4 s ramps).'),
  })
  .meta({ id: 'StyleBibleMotion', title: 'StyleBibleMotion' })
  .describe('Motion and transition grammar.');

export type StyleBibleMotion = z.infer<typeof StyleBibleMotionSchema>;

export const StyleBiblePacingSchema = z
  .strictObject({
    medianSceneSeconds: z.number().positive(),
    minSceneSeconds: z.number().positive(),
    maxSceneSeconds: z.number().positive(),
    narrationLed: z.boolean().describe('Scene changes land on narration pauses.'),
    pauseSyncShare: z
      .number()
      .min(0)
      .max(1)
      .describe('Share of cuts within 0.25 s of a narration pause (observed 0.75).'),
  })
  .meta({ id: 'StyleBiblePacing', title: 'StyleBiblePacing' })
  .describe('Scene pacing grammar.');

export type StyleBiblePacing = z.infer<typeof StyleBiblePacingSchema>;

export const StyleBibleEvidenceSchema = z
  .strictObject({
    annotationFile: z.string().min(1),
    annotationVersion: SemVerSchema,
    servedVariantSha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .describe('SHA-256 of the annotated reference binary (served variant).'),
    note: z.string().max(1000),
  })
  .meta({ id: 'StyleBibleEvidence', title: 'StyleBibleEvidence' })
  .describe('Provenance of the distilled grammar.');

export type StyleBibleEvidence = z.infer<typeof StyleBibleEvidenceSchema>;

export const StyleBibleSchema = z
  .strictObject({
    recordType: z.literal('StyleBible'),
    styleBibleVersion: z
      .string()
      .regex(new RegExp(`^${STYLE_BIBLE_MAJOR}\\.\\d+\\.\\d+$`))
      .describe(
        `StyleBible bundle version (major must match ${STYLE_BIBLE_MAJOR}.x.x).`,
      ),
    id: IdSchema,
    name: z.string().min(1).max(300),
    palette: StyleBiblePaletteSchema,
    typography: StyleBibleTypographySchema,
    layout: StyleBibleLayoutSchema,
    diagram: StyleBibleDiagramSchema,
    motion: StyleBibleMotionSchema,
    pacing: StyleBiblePacingSchema,
    rules: z.array(z.string().min(1).max(500)).min(1).describe(
      'Reconstruction rules distilled from the annotation (binding for the renderer).',
    ),
    evidence: StyleBibleEvidenceSchema,
  })
  .meta({ id: 'StyleBible', title: 'StyleBible' })
  .describe(
    'The distilled visual grammar of the reference video overview: palette, ' +
      'typography, layout, diagram, motion and pacing, each evidence-linked.',
  );

export type StyleBible = z.infer<typeof StyleBibleSchema>;

/** Runtime guard (same-major pin, mirroring the contracts discipline). */
export function isStyleBible(value: unknown): value is StyleBible {
  return StyleBibleSchema.safeParse(value).success;
}

/** Parse + validate, throwing a descriptive error on failure. */
export function parseStyleBible(value: unknown): StyleBible {
  const guard = StyleBibleSchema.safeParse(value);
  if (!guard.success) {
    throw new Error(`invalid StyleBible: ${JSON.stringify(guard.error.issues)}`);
  }
  return guard.data;
}

/**
 * The canonical StyleBible distilled from the golden reference annotation.
 * Id matches the canonical plan fixture's styleBibleId.
 *
 * Palette hexes are representative values distilled from the annotation's
 * quantized pixel buckets (median-cut shares, 8-color) and its saturated-
 * accent distribution (hue 165-180° teal dominant, ~3.9% saturated pixel
 * share), plus vision-model observations for roles the buckets cannot
 * separate (aiNode). See reference/annotations/reference-video-scenes.md.
 */
export const REFERENCE_INK_STYLE_BIBLE: StyleBible = {
  recordType: 'StyleBible',
  styleBibleVersion: STYLE_BIBLE_VERSION,
  id: 'style-bible--reference-ink',
  name: 'Reference Ink (graphite paper, cyan emphasis)',
  palette: {
    background: {
      value: '#3e4346',
      evidence:
        'OBSERVED dominant graphite background: 0.33-0.37 area share in darkest segments (annotation pixel metrics).',
    },
    backgroundDeep: {
      value: '#292a24',
      evidence: 'OBSERVED deep dark tone of terminal/paper scenes (segment 2 pixel metrics).',
    },
    surface: {
      value: '#617d83',
      evidence: 'OBSERVED slate blue-teal mid tone recurring across segments (pixel metrics).',
    },
    surfaceAlt: {
      value: '#747a7a',
      evidence: 'OBSERVED neutral grey ground of the opening hero (segment 0 pixel metrics).',
    },
    paper: {
      value: '#e3e1d6',
      evidence: 'OBSERVED light paper tone of early hero/paper scenes (segment 1 pixel metrics).',
    },
    paperAlt: {
      value: '#e9eaea',
      evidence: 'OBSERVED cool paper tone (segment 4 pixel metrics).',
    },
    ink: {
      value: '#f2f4f5',
      evidence: 'OBSERVED clean white/light-grey sans typography on dark ground (vision pass).',
    },
    inkMuted: {
      value: '#aab4b6',
      evidence: 'OBSERVED light-grey sentence-case descriptions (vision pass; derived muted ink).',
    },
    emphasis: {
      value: '#53dfcd',
      evidence:
        'OBSERVED dominant bright accent: hue 165-180° cyan/teal leads the saturated-pixel distribution (annotation method, accent extraction).',
    },
    emphasisDeep: {
      value: '#3b9f92',
      evidence: 'OBSERVED muted teal accent bucket (accent extraction).',
    },
    emphasisSoft: {
      value: '#63979f',
      evidence: 'OBSERVED soft teal-grey bucket (accent extraction).',
    },
    warning: {
      value: '#9f3b61',
      evidence:
        'OBSERVED crimson/magenta bucket (hue ~330°) used for warnings and error plaques (accent extraction + vision pass).',
    },
    accentWarm: {
      value: '#9f613b',
      evidence: 'OBSERVED orange/gold energy-accent bucket (accent extraction + vision pass).',
    },
    accentGreen: {
      value: '#87df53',
      evidence: 'OBSERVED green bucket, terminal/status accents (accent extraction).',
    },
    aiNode: {
      value: '#8f6db8',
      evidence:
        'VLM-observed purple/violet reserved for LLM/AI nodes (global style pass); representative hex.',
    },
  },
  typography: {
    labelFamily: 'sans-serif',
    codeFamily: 'monospace',
    titleSizePx: 64,
    headingSizePx: 40,
    labelSizePx: 24,
    captionSizePx: 18,
    codeSizePx: 20,
    labelCase: 'upper',
    titleWeight: 700,
    labelWeight: 600,
  },
  layout: {
    widthPx: 1280,
    heightPx: 720,
    marginPx: 64,
    gutterPx: 24,
    composition: 'center-weighted',
  },
  diagram: {
    nodeShape: 'hexagon',
    nodeFill: '#3e4346',
    nodeStroke: '#53dfcd',
    nodeStrokeWidthPx: 2.5,
    edgeStroke: '#53dfcd',
    edgeStrokeWidthPx: 2.5,
    edgeDashPattern: '',
    arrowhead: 'triangle',
    loopStyle: 'dashed-circle',
  },
  motion: {
    defaultMotion: 'static',
    allowedMotions: ['static', 'pan', 'zoom', 'parallax', 'animated-diagram'],
    preferredTransition: 'crossfade',
    crossfadeShare: 0.52,
    hardCutShare: 0.375,
    transitionSeconds: 0.4,
  },
  pacing: {
    medianSceneSeconds: 7.47,
    minSceneSeconds: 2,
    maxSceneSeconds: 27.4,
    narrationLed: true,
    pauseSyncShare: 0.75,
  },
  rules: [
    'Exact labels, numbers, node names and step names render as crisp structured graphics — never as text inside generated illustration.',
    'Illustration carries metaphor, atmosphere and hardware; it never carries facts that must be exact.',
    'The background is a flat dark graphite/slate field; light paper scenes are a deliberate early-beat contrast device.',
    'Cyan/teal is the connective/emphasis ink; crimson is reserved for warning semantics; purple marks model/AI nodes.',
    'Scene changes are narration-led: cut on or near speech pauses, crossfade preferred over hard cut.',
    'Most scenes are static; motion is spent deliberately (opening hero, animated diagrams, closing).',
    'Center-weighted composition with generous negative space; split-screen for contrasts; radial layouts for loops and networks.',
    'Recurring motifs (controller mark, hexagonal nodes, glowing edges, timeline rulers) recur with controlled variation.',
    'Scene density follows narration (median ~7.5 s), not a fixed cadence.',
    'The product closes on a clean branded end card.',
  ],
  evidence: {
    annotationFile: 'reference/annotations/reference-video-scenes.json',
    annotationVersion: '1.0.0',
    servedVariantSha256:
      'f1241c219a42906d35030eb01f51be490f5ec95ba0682d4b1c629ee88031768b',
    note: 'Distilled from the full-duration annotation (49 segments) of the served variant; original pin preserved separately in the artifact manifest.',
  },
};

/** Registry of known StyleBibles shipped with the lab (deterministic order). */
export const KNOWN_STYLE_BIBLES: readonly StyleBible[] = [REFERENCE_INK_STYLE_BIBLE];

/** Look up a known StyleBible by id (the plan's styleBibleId namespace). */
export function styleBibleById(id: string): StyleBible | undefined {
  return KNOWN_STYLE_BIBLES.find((bible) => bible.id === id);
}

/** Resolve the StyleBible for a plan/scene reference, with deterministic default. */
export function resolveStyleBible(id: string | undefined): StyleBible {
  const found = id === undefined ? undefined : styleBibleById(id);
  if (id !== undefined && found === undefined) {
    // Unknown StyleBible ids degrade to the canonical instance with a typed
    // signal upstream (the compiler records a QA issue); never throw here so
    // partial plans remain inspectable.
    return REFERENCE_INK_STYLE_BIBLE;
  }
  return found ?? REFERENCE_INK_STYLE_BIBLE;
}
