/**
 * Video pipeline (WFLX-W3) — the SceneGraph: the storyboard working IR.
 *
 * NOT a shared contract (the shared output contract remains the frozen
 * VideoScene[] from W1). Mirrors W2's DialogueGraph position (DESIGN.md
 * §16.2): the plan's `videoScenes` are PLAN-AUTHORITATIVE — this compiler
 * never adds, drops, reorders or re-types scenes. It validates them against
 * the plan + SemanticGraph, resolves their grounding (claims -> entities ->
 * relationships), derives deterministic render specs, and realizes narration
 * segments. The enriched copy of each scene carries the W3 enrichment
 * (styleBible binding, narration refs, derived visual briefs).
 */

import type {
  ClaimRecord,
  EntityRecord,
  Id,
  OverviewPlan,
  RelationshipRecord,
  VideoScene,
} from '../../contracts';
import type { StyleBible } from '../style-bible';

/** Resolved grounding for one scene, from the SemanticGraph. */
export interface SceneGrounding {
  readonly claims: readonly ClaimRecord[];
  readonly entities: readonly EntityRecord[];
  readonly relationships: readonly RelationshipRecord[];
  /** Stable, deduped entity display names (drives diagram node labels). */
  readonly entityNames: readonly string[];
  /** Claim statements in plan order (drives narration and captions). */
  readonly claimStatements: readonly string[];
}

/** One diagram node in a render spec (grounded by an entity id). */
export interface DiagramNodeSpec {
  readonly id: Id;
  readonly label: string;
  readonly kind: string;
  /** True when the entity is a model/LLM-kind thing (purple accent per StyleBible). */
  readonly aiFlavored: boolean;
}

/** One diagram edge in a render spec (grounded by a relationship id). */
export interface DiagramEdgeSpec {
  readonly id: Id;
  readonly fromId: Id;
  readonly toId: Id;
  readonly label: string;
}

/** Layout hint derived from the visual type (contract vocabulary). */
export type LayoutKind =
  | 'title'
  | 'diagram'
  | 'flow'
  | 'table'
  | 'chart'
  | 'code'
  | 'quote'
  | 'callout'
  | 'montage'
  | 'illustration';

/** Deterministic rendering instructions for one scene. */
export interface RenderSpec {
  readonly visualType: VideoScene['visualType'];
  readonly layoutKind: LayoutKind;
  readonly title?: string;
  readonly caption?: string;
  /** Exact texts to place (from the plan scene's exactTexts, validated). */
  readonly labels: readonly string[];
  readonly nodes: readonly DiagramNodeSpec[];
  readonly edges: readonly DiagramEdgeSpec[];
  /** Ordered steps for flow layouts (grounded by process/workflow entities). */
  readonly steps: readonly string[];
  /** Quote source text for quote panels (grounded by claim evidence). */
  readonly quote?: string;
  /** Code lines for code panels (grounded, redaction-safe synthesis). */
  readonly codeLines: readonly string[];
  /** Table rows for table layouts. */
  readonly rows: readonly (readonly string[])[];
  /** Bar data for chart layouts (grounded by entity kinds/counts). */
  readonly chartBars: readonly { readonly label: string; readonly value: number }[];
  /** Brief for the generative illustration layer (provider-neutral). */
  readonly illustrationBrief: string;
  /** Per-scene deterministic seed for layout/illustration choices. */
  readonly seed: string;
}

/** Realized narration for one scene (W3 owns narration segments for video plans). */
export interface SceneNarration {
  readonly segmentId: string;
  readonly text: string;
  /** Deterministic speaking-time estimate for the narration manifest. */
  readonly estimatedSeconds: number;
}

/** One enriched scene in the storyboard. */
export interface StoryboardScene {
  readonly scene: VideoScene;
  readonly grounding: SceneGrounding;
  readonly render: RenderSpec;
  readonly narration: SceneNarration;
}

export interface SceneGraphMeta {
  readonly planId: Id;
  readonly planHash: string;
  readonly mode: string;
  readonly language: string;
  readonly seed: string;
  readonly styleBibleId: Id;
  readonly styleBibleVersion: string;
  readonly compiler: string;
}

/** The storyboard: validated + enriched scenes with render specs. */
export interface SceneGraph {
  readonly meta: SceneGraphMeta;
  readonly scenes: readonly StoryboardScene[];
  readonly styleBible: StyleBible;
  /** Input plan (plan-authoritative reference). */
  readonly plan: OverviewPlan;
}

/** Soft issue surfaced by the compiler (hard failures throw VideoCompilerError). */
export interface SceneCompilerIssue {
  readonly code: string;
  readonly message: string;
  readonly sceneId?: Id;
  readonly severity: 'info' | 'warning' | 'error';
}
