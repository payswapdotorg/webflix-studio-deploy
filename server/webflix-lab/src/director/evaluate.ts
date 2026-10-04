/**
 * Groundedness / coverage evaluator (WFLX-W1, Stage 2).
 *
 * Given a plan (or a turn/scene list from Workers 2/3), compute claim
 * coverage, unsupported-claim flags, evidence linkage and exact-label
 * grounding against the sources. Pure functions over the frozen IR; the
 * Director self-checks with the same evaluator, and experiments use it to
 * compare reference vs lab outputs.
 */

import type {
  AudioTurn,
  Id,
  OverviewPlan,
  SemanticGraph,
  SourceArtifact,
  ValidationIssue,
  VideoScene,
} from '../contracts';
import { validateOverviewPlan } from '../contracts';
import { GraphIndex } from '../source/graph/retrieval';

export interface EvidenceLinkError {
  unitId: string;
  claimId: string;
  issue: string;
}

export interface CoverageEvaluation {
  totalClaims: number;
  coveredClaims: number;
  omittedClaims: number;
  /** covered / total * 100, one decimal. */
  coveragePercent: number;
  /** claimIds referenced by beats/turns/scenes that do not exist in the graph. */
  unsupportedClaimRefs: string[];
  /** graph claims neither covered nor omitted (should be empty for Director plans). */
  unaccountedClaimIds: string[];
  /** broken evidence links (bad offsets, quote mismatches, dangling blocks). */
  evidenceLinkErrors: EvidenceLinkError[];
  roleCounts: { primary: number; supporting: number; mention: number };
  /** structural plan issues (weights, durations, unit refs) from the deep validator. */
  structuralIssues: ValidationIssue[];
  /** every claim accounted for, no unsupported refs, no evidence errors. */
  grounded: boolean;
}

export function evaluateCoverage(
  plan: OverviewPlan,
  graph: SemanticGraph,
  sources: readonly SourceArtifact[] | SourceArtifact,
): CoverageEvaluation {
  const sourceList = Array.isArray(sources) ? sources : [sources];
  const index = new GraphIndex(graph, sourceList);

  const coveredIds = new Set(plan.coverage.covered.map((c) => c.claimId));
  const omittedIds = new Set(plan.coverage.omitted.map((o) => o.claimId));
  const graphIds = new Set(graph.claims.map((c) => c.id));

  const unsupportedClaimRefs = new Set<string>();
  const pushRef = (claimId: Id): void => {
    if (!graphIds.has(claimId)) unsupportedClaimRefs.add(claimId);
  };

  const evidenceLinkErrors: EvidenceLinkError[] = [];
  const checkEvidence = (unitId: string, claimId: Id): void => {
    for (const span of index.getClaim(claimId)?.evidence ?? []) {
      const issue = index.verifySpan(span);
      if (issue !== null) evidenceLinkErrors.push({ unitId, claimId, issue });
    }
  };

  for (const beat of plan.beats) {
    for (const claimId of beat.claimIds) {
      pushRef(claimId);
      checkEvidence(beat.id, claimId);
    }
  }
  for (const turn of plan.audioTurns) {
    for (const claimId of turn.claimIds) {
      pushRef(claimId);
      checkEvidence(turn.id, claimId);
    }
    for (const span of turn.evidence) {
      const issue = index.verifySpan(span);
      if (issue !== null) evidenceLinkErrors.push({ unitId: turn.id, claimId: span.blockId, issue });
    }
  }
  for (const scene of plan.videoScenes) {
    for (const claimId of scene.claimIds) {
      pushRef(claimId);
      checkEvidence(scene.id, claimId);
    }
  }

  const unaccountedClaimIds = graph.claims
    .map((c) => c.id)
    .filter((id) => !coveredIds.has(id) && !omittedIds.has(id));

  const structural = validateOverviewPlan(plan, graph, sourceList);
  const structuralIssues = structural.issues.filter((i) => !i.path.startsWith('coverage.'));

  const coveredInGraph = [...coveredIds].filter((id) => graphIds.has(id));
  const total = graph.claims.length;

  return {
    totalClaims: total,
    coveredClaims: coveredInGraph.length,
    omittedClaims: plan.coverage.omitted.length,
    coveragePercent: total === 0 ? 0 : Math.round((coveredInGraph.length / total) * 1000) / 10,
    unsupportedClaimRefs: [...unsupportedClaimRefs].sort(),
    unaccountedClaimIds,
    evidenceLinkErrors,
    roleCounts: {
      primary: plan.coverage.covered.filter((c) => c.role === 'primary').length,
      supporting: plan.coverage.covered.filter((c) => c.role === 'supporting').length,
      mention: plan.coverage.covered.filter((c) => c.role === 'mention').length,
    },
    structuralIssues,
    grounded:
      unaccountedClaimIds.length === 0 &&
      unsupportedClaimRefs.size === 0 &&
      evidenceLinkErrors.length === 0 &&
      structuralIssues.length === 0,
  };
}

export interface TurnListEvaluation {
  turnCount: number;
  /** Turns with at least one verifiable evidence span. */
  groundedTurns: number;
  unsupportedClaimRefs: string[];
  evidenceLinkErrors: EvidenceLinkError[];
  grounded: boolean;
}

/** Later-stage evaluation for compiled AudioTurn[] (Worker 2 scripts). */
export function evaluateAudioTurns(
  turns: readonly AudioTurn[],
  graph: SemanticGraph,
  sources: readonly SourceArtifact[] | SourceArtifact,
): TurnListEvaluation {
  const sourceList = Array.isArray(sources) ? sources : [sources];
  const index = new GraphIndex(graph, sourceList);
  const graphIds = new Set(graph.claims.map((c) => c.id));
  const unsupportedClaimRefs = new Set<string>();
  const evidenceLinkErrors: EvidenceLinkError[] = [];
  let groundedTurns = 0;

  for (const turn of turns) {
    let grounded = false;
    for (const claimId of turn.claimIds) {
      if (!graphIds.has(claimId)) {
        unsupportedClaimRefs.add(claimId);
        continue;
      }
      const spans = index.evidenceForClaim(claimId);
      if (spans.length > 0) grounded = true;
    }
    for (const span of turn.evidence) {
      const issue = index.verifySpan(span);
      if (issue !== null) {
        evidenceLinkErrors.push({ unitId: turn.id, claimId: span.blockId, issue });
      } else {
        grounded = true;
      }
    }
    if (grounded) groundedTurns += 1;
  }

  return {
    turnCount: turns.length,
    groundedTurns,
    unsupportedClaimRefs: [...unsupportedClaimRefs].sort(),
    evidenceLinkErrors,
    grounded:
      unsupportedClaimRefs.size === 0 && evidenceLinkErrors.length === 0 && groundedTurns === turns.length,
  };
}

export interface SceneListEvaluation {
  sceneCount: number;
  /** Deterministic/hybrid scenes with at least one exact label grounded in a source. */
  labelGroundedScenes: number;
  labelIssues: { sceneId: string; value: string; issue: string }[];
  unsupportedClaimRefs: string[];
  evidenceLinkErrors: EvidenceLinkError[];
  grounded: boolean;
}

/** Later-stage evaluation for compiled VideoScene[] (Worker 3 storyboards). */
export function evaluateVideoScenes(
  scenes: readonly VideoScene[],
  graph: SemanticGraph,
  sources: readonly SourceArtifact[] | SourceArtifact,
): SceneListEvaluation {
  const sourceList = Array.isArray(sources) ? sources : [sources];
  const index = new GraphIndex(graph, sourceList);
  const graphIds = new Set(graph.claims.map((c) => c.id));
  const allText = sourceList.map((s) => s.text).join('\n');
  const unsupportedClaimRefs = new Set<string>();
  const evidenceLinkErrors: EvidenceLinkError[] = [];
  const labelIssues: { sceneId: string; value: string; issue: string }[] = [];
  let labelGroundedScenes = 0;

  for (const scene of scenes) {
    let labelGrounded = false;
    for (const claimId of scene.claimIds) {
      if (!graphIds.has(claimId)) {
        unsupportedClaimRefs.add(claimId);
        continue;
      }
      for (const span of index.evidenceForClaim(claimId)) {
        const issue = index.verifySpan(span);
        if (issue !== null) evidenceLinkErrors.push({ unitId: scene.id, claimId, issue });
      }
    }
    for (const item of scene.exactTexts) {
      if (!item.exact) continue;
      // Only fact-bearing roles (labels, numbers, quotes) must be source
      // substrings; titles and captions are editorial framing and may be
      // stylized (scene atlas rule 2 concerns labels/numbers/relationships).
      if (item.role !== 'label' && item.role !== 'number' && item.role !== 'quote') {
        labelGrounded = true;
        continue;
      }
      if (allText.includes(item.value)) {
        labelGrounded = true;
      } else {
        labelIssues.push({
          sceneId: scene.id,
          value: item.value.length > 40 ? `${item.value.slice(0, 37)}...` : item.value,
          issue: 'exact label not found in any source text',
        });
      }
    }
    if (scene.renderingClass === 'generative') labelGrounded = true; // no labels required
    if (labelGrounded) labelGroundedScenes += 1;
  }

  return {
    sceneCount: scenes.length,
    labelGroundedScenes,
    labelIssues,
    unsupportedClaimRefs: [...unsupportedClaimRefs].sort(),
    evidenceLinkErrors,
    grounded:
      unsupportedClaimRefs.size === 0 &&
      evidenceLinkErrors.length === 0 &&
      labelIssues.length === 0 &&
      labelGroundedScenes === scenes.length,
  };
}
