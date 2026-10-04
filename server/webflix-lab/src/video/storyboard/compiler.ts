/**
 * Video pipeline (WFLX-W3) — the VideoScene compiler.
 *
 * `OverviewPlan -> VideoScene[]` per the W1 contract (task packet, Phase 2B):
 * validates the plan's authoritative scene skeleton against the plan +
 * SemanticGraph (grounding), enriches it deterministically (StyleBible
 * binding, narration refs, derived visual briefs), resolves per-scene
 * grounding (claims -> entities -> relationships), derives deterministic
 * render specs, and realizes narration segments.
 *
 * Plan authority (mirrors W2 DESIGN.md §16.2): scenes are never added,
 * dropped, reordered or re-typed. Hard validation failures throw
 * VideoCompilerError; soft quality problems surface as SceneCompilerIssue.
 *
 * Determinism: identical (plan, graph, seed) produce byte-identical outputs.
 * All stochastic choices key on (seed, scene-LOCAL content hash, mode,
 * sceneId, choice) — the C-5 v2 re-keying
 * (src/contracts/unit-content-hash.ts documents this composition as the
 * video-scene surface): the hash covers [narrativePurpose, narrationBrief,
 * visualBrief, ...anchorStatements, ...exactTexts], so a one-claim change
 * reshuffles only the scenes whose OWN content changed. planHash stays OUT
 * of stochastic keys (it remains in identification surfaces — storyboard
 * meta, artifact ids, QA reports — by design).
 */

import { createHash } from 'node:crypto';
import {
  unitContentHash,
  type ClaimRecord,
  type EntityRecord,
  type Id,
  type OverviewPlan,
  type RelationshipRecord,
  type SceneTextItem,
  type SemanticGraph,
  type VideoScene,
} from '../../contracts';
import { VideoCompilerError } from '../errors';
import type { SceneCompilerIssue } from './types';
import { REFERENCE_INK_STYLE_BIBLE, STYLE_BIBLE_VERSION, resolveStyleBible, type StyleBible } from '../style-bible';
import { pickFor } from '../rng';
import type {
  DiagramEdgeSpec,
  DiagramNodeSpec,
  LayoutKind,
  RenderSpec,
  SceneGraph,
  SceneGrounding,
  SceneNarration,
  StoryboardScene,
} from './types';

export const VIDEO_COMPILER_ID = 'wflx-video-compiler';

/** Visual types the Director classifies deterministic (alignment with W1). */
export const DETERMINISTIC_VISUAL_TYPES: readonly string[] = [
  'title-card',
  'table',
  'callout',
  'quote-panel',
  'architecture-diagram',
  'state-diagram',
  'process-flow',
  'data-chart',
  'code-panel',
];

/** Generative-only visual types (illustration without exact facts). */
export const GENERATIVE_VISUAL_TYPES: readonly string[] = [
  'hero-illustration',
  'metaphor-illustration',
];

/** Hybrid-allowed visual types (deterministic core + illustration shell). */
export const HYBRID_VISUAL_TYPES: readonly string[] = [
  'hero-illustration',
  'metaphor-illustration',
  'workstation-scene',
  'montage',
  'code-panel',
  'data-chart',
];

/** Default narration speaking rate (words per second) for estimates. */
export const NARRATION_WPS = 2.5;

/** Hard tolerance for scene-duration sum vs plan target (fraction). */
const DURATION_HARD_TOLERANCE = 0.15;
/** Soft tolerance for scene-duration sum vs plan target (fraction). */
const DURATION_SOFT_TOLERANCE = 0.02;

/** Stable JSON stringify: object keys sorted recursively (W2 convention). */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** Content hash of a plan (binds the storyboard to the exact plan input). */
export function planHashOf(plan: OverviewPlan): string {
  return createHash('sha256').update(stableStringify(plan)).digest('hex');
}

export interface CompileVideoScenesOptions {
  /** Deterministic seed; defaults to the plan generator's seed. */
  readonly seed?: string;
  /** Explicit StyleBible override; defaults to resolving the plan's reference. */
  readonly styleBible?: StyleBible;
}

export interface CompileVideoScenesResult {
  /** Realized contract-level scenes (authoritative structure + W3 enrichment). */
  readonly scenes: readonly VideoScene[];
  readonly storyboard: SceneGraph;
  readonly issues: readonly SceneCompilerIssue[];
}

interface GraphIndex {
  readonly claims: ReadonlyMap<Id, ClaimRecord>;
  readonly entities: ReadonlyMap<Id, EntityRecord>;
  readonly relationships: readonly RelationshipRecord[];
}

function indexGraph(graph: SemanticGraph): GraphIndex {
  return {
    claims: new Map(graph.claims.map((claim) => [claim.id, claim])),
    entities: new Map(graph.entities.map((entity) => [entity.id, entity])),
    relationships: graph.relationships,
  };
}

function resolveGrounding(scene: VideoScene, index: GraphIndex): SceneGrounding {
  const claims: ClaimRecord[] = [];
  for (const claimId of scene.claimIds) {
    const claim = index.claims.get(claimId);
    if (claim !== undefined) {
      claims.push(claim);
    }
  }
  const entities: EntityRecord[] = [];
  const seen = new Set<Id>();
  for (const claim of claims) {
    for (const entityId of claim.entityIds) {
      if (!seen.has(entityId)) {
        seen.add(entityId);
        const entity = index.entities.get(entityId);
        if (entity !== undefined) {
          entities.push(entity);
        }
      }
    }
  }
  const entityIds = new Set(entities.map((entity) => entity.id));
  const relationships = index.relationships.filter(
    (rel) => entityIds.has(rel.subjectId) && entityIds.has(rel.objectId),
  );
  return {
    claims,
    entities,
    relationships,
    entityNames: entities.map((entity) => entity.name),
    claimStatements: claims.map((claim) => claim.statement),
  };
}

function textsOfRole(texts: readonly SceneTextItem[], role: SceneTextItem['role']): string[] {
  return texts.filter((item) => item.role === role).map((item) => item.value);
}

const LAYOUT_BY_TYPE: Readonly<Record<VideoScene['visualType'], LayoutKind>> = {
  'title-card': 'title',
  'architecture-diagram': 'diagram',
  'state-diagram': 'diagram',
  'process-flow': 'flow',
  'data-chart': 'chart',
  'code-panel': 'code',
  'quote-panel': 'quote',
  callout: 'callout',
  'hero-illustration': 'illustration',
  'metaphor-illustration': 'illustration',
  'workstation-scene': 'illustration',
  montage: 'montage',
  table: 'table',
};

function isAiFlavored(entity: EntityRecord): boolean {
  return (
    entity.kind === 'model' ||
    /(^|\s)(llm|ai|gpt|gemini|model)(\s|$|\/|-)/i.test(entity.name)
  );
}

function diagramNodes(grounding: SceneGrounding): DiagramNodeSpec[] {
  return grounding.entities.slice(0, 7).map((entity) => ({
    id: entity.id,
    label: entity.name,
    kind: entity.kind,
    aiFlavored: isAiFlavored(entity),
  }));
}

function diagramEdges(grounding: SceneGrounding): DiagramEdgeSpec[] {
  return grounding.relationships.slice(0, 6).map((rel) => ({
    id: rel.id,
    fromId: rel.subjectId,
    toId: rel.objectId,
    label: rel.predicate,
  }));
}

/**
 * Grounded, redaction-safe code-panel synthesis. Never renders raw source
 * text beyond entity names and claim statements (which are already lab-safe
 * fixtures); no credential-shaped value can appear by construction.
 */
function codeLinesFor(grounding: SceneGrounding, scene: VideoScene): string[] {
  const lines: string[] = [];
  const stack = grounding.entityNames.slice(0, 4);
  lines.push(`// scene: ${scene.id} — ${scene.visualType}`);
  if (stack.length > 0) {
    lines.push(`const stack = [${stack.map((name) => JSON.stringify(name)).join(', ')}];`);
  }
  const first = grounding.claimStatements[0];
  if (first !== undefined) {
    lines.push(`// grounded: ${first.slice(0, 90)}`);
    lines.push('orchestrate(stack, { audits: true });');
  } else {
    lines.push('// no claims attached to this panel');
  }
  return lines;
}

function chartBarsFor(grounding: SceneGrounding): { label: string; value: number }[] {
  // Honest grounded metric: exact mention count per entity (from the graph).
  return grounding.entities.slice(0, 6).map((entity) => ({
    label: entity.name,
    value: entity.mentions.length,
  }));
}

function tableRowsFor(grounding: SceneGrounding): (readonly string[])[] {
  return grounding.entities.slice(0, 6).map((entity) => [entity.name, entity.kind]);
}

function stepsFor(grounding: SceneGrounding): string[] {
  const processes = grounding.entities.filter(
    (entity) => entity.kind === 'process' || entity.kind === 'workflow',
  );
  if (processes.length > 0) {
    return processes.slice(0, 5).map((entity) => entity.name);
  }
  return grounding.entityNames.slice(0, 5);
}

function quoteFor(grounding: SceneGrounding): string | undefined {
  for (const claim of grounding.claims) {
    const span = claim.evidence[0];
    if (span !== undefined) {
      return span.quote.length > 180 ? span.quote.slice(0, 177) + '…' : span.quote;
    }
  }
  return undefined;
}

function deriveVisualBrief(
  scene: VideoScene,
  grounding: SceneGrounding,
  styleBible: StyleBible,
  key: string,
): string {
  const motif = pickFor(`${key}:motif`, [
    'central controller mark with hexagonal downstream nodes',
    'isometric technical hardware with connecting conduits',
    'glowing network lattice on graphite ground',
    'dashed circular pathway around a core mechanism',
  ]);
  const names = grounding.entityNames.slice(0, 3).join(', ');
  const emphasis = styleBible.palette.emphasis.value;
  return (
    `Hand-drawn ink technical illustration in the ${styleBible.name} grammar: ` +
    `${motif}; graphite ground; ${emphasis} cyan/teal emphasis linework; ` +
    (names !== '' ? `anchored to: ${names}. ` : '') +
    'no exact text inside the illustration (labels render deterministically).'
  );
}

function realizeNarrationText(
  scene: VideoScene,
  grounding: SceneGrounding,
  styleBible: StyleBible,
  key: string,
): string {
  const opener = pickFor(`${key}:opener`, [
    'Now,',
    'Here,',
    'Next,',
    'In this segment,',
    'Looking closer,',
  ]);
  const first = grounding.claimStatements[0] ?? scene.narrationBrief;
  const second = grounding.claimStatements[1];
  const names = grounding.entityNames.slice(0, 2).join(' and ');
  let text = `${opener} ${first.charAt(0).toLowerCase()}${first.slice(1)}`;
  if (second !== undefined) {
    text += ` ${second.charAt(0).toLowerCase()}${second.slice(1)}`;
  }
  if (names !== '' && !text.includes(names.split(' and ')[0] ?? '')) {
    text += ` Watch for ${names}.`;
  }
  // StyleBible narration-led pacing note is a compiler convention, not speech.
  void styleBible;
  return text.replace(/\s+/g, ' ').trim();
}

function narrationSeconds(text: string): number {
  const words = text.split(/\s+/).filter((word) => word.length > 0).length;
  return Math.max(2, Math.round((words / NARRATION_WPS) * 10) / 10);
}

function modeIssues(plan: OverviewPlan): SceneCompilerIssue[] {
  const issues: SceneCompilerIssue[] = [];
  // DOCUMENTED (docs/notebooklm-overviews-research.md): Explainer = narrated
  // slides combining generated visuals with diagrams, quotes and numbers.
  if (plan.mode === 'explainer') {
    const hasStructured = plan.videoScenes.some(
      (scene) => scene.renderingClass !== 'generative' && scene.exactTexts.length > 0,
    );
    if (!hasStructured) {
      issues.push({
        severity: 'warning',
        code: 'explainer-structured-scene-missing',
        message:
          'DOCUMENTED Explainer semantics expect diagram/quote/number scenes with exact texts; none found (AGENTS.md label: DOCUMENTED expectation, structural check).',
      });
    }
  } else if (plan.mode === 'short') {
    // HYPOTHESIS: Short is a shorter format; bound inferred, not documented.
    if (plan.targetDurationSeconds > 180) {
      issues.push({
        severity: 'warning',
        code: 'short-mode-duration',
        message: `Short-mode plan targets ${plan.targetDurationSeconds}s > 180s (HYPOTHESIS-grade bound; not DOCUMENTED).`,
      });
    }
  } else if (plan.mode === 'cinematic') {
    issues.push({
      severity: 'info',
      code: 'cinematic-semantics-unresolved',
      message:
        'Cinematic mode semantics are UNRESOLVED in this lab; the first visual target is Explainer (docs/notebooklm-overviews-research.md). Rendering proceeds with Explainer grammar.',
    });
  }
  return issues;
}

/**
 * Compile the plan's authoritative VideoScene[] into the realized scene list
 * plus the W3 storyboard. Deterministic and seeded.
 */
export function compileVideoScenes(
  plan: OverviewPlan,
  graph: SemanticGraph,
  options: CompileVideoScenesOptions = {},
): CompileVideoScenesResult {
  if (plan.modality !== 'video') {
    throw new VideoCompilerError(
      `compileVideoScenes requires a video-modality plan (got '${plan.modality}')`,
    );
  }
  if (plan.videoScenes.length === 0) {
    throw new VideoCompilerError('plan carries no videoScenes (guard requires >= 1)');
  }

  const index = indexGraph(graph);
  const beatIds = new Set(plan.beats.map((beat) => beat.id));
  const seed = options.seed ?? plan.generator.seed;
  const planHash = planHashOf(plan);
  const issues: SceneCompilerIssue[] = [];

  // --- StyleBible resolution
  const referencedId = plan.style.styleBibleId;
  let styleBible: StyleBible;
  if (options.styleBible !== undefined) {
    styleBible = options.styleBible;
  } else if (referencedId !== undefined) {
    styleBible = resolveStyleBible(referencedId);
    if (styleBible.id !== referencedId) {
      issues.push({
        severity: 'warning',
        code: 'style-bible-unknown',
        message: `Plan references unknown StyleBible '${referencedId}'; degraded to canonical '${styleBible.id}' (v${STYLE_BIBLE_VERSION}).`,
      });
    }
  } else {
    styleBible = REFERENCE_INK_STYLE_BIBLE;
    issues.push({
      severity: 'info',
      code: 'style-bible-defaulted',
      message: `Plan carries no styleBibleId; using canonical '${styleBible.id}' (v${STYLE_BIBLE_VERSION}).`,
    });
  }

  // --- hard validation of the authoritative skeleton
  const hardFailures: SceneCompilerIssue[] = [];
  plan.videoScenes.forEach((scene, position) => {
    if (scene.index !== position) {
      hardFailures.push({
        severity: 'error',
        code: 'scene-index-mismatch',
        message: `scene ${scene.id} has index ${scene.index}, expected ${position}`,
        sceneId: scene.id,
      });
    }
    for (const claimId of scene.claimIds) {
      if (!index.claims.has(claimId)) {
        hardFailures.push({
          severity: 'error',
          code: 'unknown-claim',
          message: `scene ${scene.id} references unknown claim ${claimId}`,
          sceneId: scene.id,
        });
      }
    }
    if (scene.beatId !== undefined && !beatIds.has(scene.beatId)) {
      hardFailures.push({
        severity: 'error',
        code: 'unknown-beat',
        message: `scene ${scene.id} references unknown beat ${scene.beatId}`,
        sceneId: scene.id,
      });
    }
    if (scene.renderingClass !== 'generative' && scene.exactTexts.length === 0) {
      hardFailures.push({
        severity: 'error',
        code: 'exact-texts-missing',
        message:
          `${scene.id} is ${scene.renderingClass} (${scene.visualType}) but carries no exact texts ` +
          '(scene atlas rule 2: exact labels render deterministically)',
        sceneId: scene.id,
      });
    }
    if (DETERMINISTIC_VISUAL_TYPES.includes(scene.visualType) && scene.renderingClass === 'generative') {
      hardFailures.push({
        severity: 'error',
        code: 'rendering-class-conflict',
        message: `${scene.id} has deterministic visual type '${scene.visualType}' but renderingClass 'generative'`,
        sceneId: scene.id,
      });
    }
  });
  if (hardFailures.length > 0) {
    throw new VideoCompilerError(
      `plan scene skeleton fails video-surface validation (${hardFailures.length} hard failures)`,
      hardFailures,
    );
  }

  // --- duration accounting
  const sceneSum = plan.videoScenes.reduce(
    (total, scene) => total + scene.targetDurationSeconds,
    0,
  );
  const drift = Math.abs(sceneSum - plan.targetDurationSeconds) / plan.targetDurationSeconds;
  if (drift > DURATION_HARD_TOLERANCE) {
    throw new VideoCompilerError(
      `scene durations sum to ${sceneSum}s vs plan target ${plan.targetDurationSeconds}s ` +
        `(drift ${(drift * 100).toFixed(1)}% exceeds hard tolerance ${(DURATION_HARD_TOLERANCE * 100).toFixed(0)}%)`,
    );
  }
  if (drift > DURATION_SOFT_TOLERANCE) {
    issues.push({
      severity: 'warning',
      code: 'scene-duration-drift',
      message: `scene durations sum to ${sceneSum}s vs plan target ${plan.targetDurationSeconds}s (drift ${(drift * 100).toFixed(1)}%)`,
    });
  }

  // --- per-scene enrichment (deterministic)
  const storyboardScenes: StoryboardScene[] = plan.videoScenes.map((scene) => {
    const grounding = resolveGrounding(scene, index);
    // C-5: scene-LOCAL content hash replaces the plan-global planHash in
    // the stochastic key (composition per src/contracts/unit-content-hash.ts:
    // [narrativePurpose, narrationBrief, visualBrief, ...anchorStatements,
    // ...exactTexts as 'role:value' pairs]; the DERIVED visual brief is a
    // function of this key, so only the plan's OWN brief feeds the hash —
    // '' when absent). mode and scene.id stay PURE identifiers.
    const sceneHash = unitContentHash([
      scene.narrativePurpose,
      scene.narrationBrief,
      scene.visualBrief ?? '',
      ...grounding.claimStatements,
      ...scene.exactTexts.map((item) => `${item.role}:${item.value}`),
    ]);
    const key = `${seed}|${sceneHash}|${plan.mode}|${scene.id}`;

    const title = textsOfRole(scene.exactTexts, 'title')[0];
    const caption = textsOfRole(scene.exactTexts, 'caption')[0];
    const labels = scene.exactTexts.map((item) => item.value);

    const render: RenderSpec = {
      visualType: scene.visualType,
      layoutKind: LAYOUT_BY_TYPE[scene.visualType],
      ...(title !== undefined ? { title } : {}),
      ...(caption !== undefined ? { caption } : {}),
      labels,
      nodes: diagramNodes(grounding),
      edges: diagramEdges(grounding),
      steps: stepsFor(grounding),
      ...(quoteFor(grounding) !== undefined ? { quote: quoteFor(grounding) } : {}),
      codeLines: codeLinesFor(grounding, scene),
      rows: tableRowsFor(grounding),
      chartBars: chartBarsFor(grounding),
      illustrationBrief:
        scene.visualBrief ?? deriveVisualBrief(scene, grounding, styleBible, key),
      seed: key,
    };

    const narrationText = realizeNarrationText(scene, grounding, styleBible, key);
    const narration: SceneNarration = {
      segmentId: scene.narrationRef ?? `narr-${scene.id}`,
      text: narrationText,
      estimatedSeconds: narrationSeconds(narrationText),
    };

    const realized: VideoScene = {
      ...scene,
      styleBibleId: scene.styleBibleId ?? styleBible.id,
      ...(scene.narrationRef === undefined
        ? { narrationRef: narration.segmentId }
        : {}),
      ...(scene.visualBrief === undefined && scene.renderingClass !== 'deterministic'
        ? { visualBrief: render.illustrationBrief }
        : {}),
    };

    if (scene.claimIds.length === 0) {
      issues.push({
        severity: 'warning',
        code: 'ungrounded-scene',
        message: `${scene.id} carries no claim ids; visual grounding QA will flag it`,
        sceneId: scene.id,
      });
    }
    if (scene.narrationRef === undefined) {
      issues.push({
        severity: 'info',
        code: 'narration-ref-derived',
        message: `${scene.id} had no narrationRef; derived '${narration.segmentId}'`,
        sceneId: scene.id,
      });
    }

    return { scene: realized, grounding, render, narration };
  });

  // --- coverage through the video surface (H-4 boundary semantics)
  const sceneClaimIds = new Set(storyboardScenes.flatMap((entry) => entry.scene.claimIds));
  for (const covered of plan.coverage.covered) {
    if (!sceneClaimIds.has(covered.claimId)) {
      issues.push({
        severity: 'warning',
        code: 'coverage-gap',
        message: `claim ${covered.claimId} is covered by the plan (units: ${covered.unitIds.join(', ')}) but no scene visualizes it (video-surface interpretation of the H-4 boundary ruling)`,
      });
    }
  }

  issues.push(...modeIssues(plan));

  const storyboard: SceneGraph = {
    meta: {
      planId: plan.id,
      planHash,
      mode: plan.mode,
      language: plan.language,
      seed,
      styleBibleId: styleBible.id,
      styleBibleVersion: styleBible.styleBibleVersion,
      compiler: `${VIDEO_COMPILER_ID}@0.1.0`,
    },
    scenes: storyboardScenes,
    styleBible,
    plan,
  };

  return { scenes: storyboardScenes.map((entry) => entry.scene), storyboard, issues };
}
