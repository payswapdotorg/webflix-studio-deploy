/**
 * LlmExtractor port (WFLX-W1, Stage 2).
 *
 * Provider-neutral extraction port: sources in, SemanticGraph out. Real LLM
 * adapters are a later TL-side decision; the lab's default implementation is
 * DeterministicExtractor (rule-based, fully offline, testable — no network,
 * no API keys, deterministic output).
 *
 * Contract obligations for every implementation:
 * - graph must pass the SemanticGraph guard (referential integrity included);
 * - every evidence span / entity mention must verify against the provided
 *   sources (validateSemanticGraph);
 * - deterministic implementations MUST return byte-identical output for
 *   identical inputs (no ambient state).
 */

import type { SemanticGraph, SourceArtifact, UtcTimestamp } from '../../contracts';

export interface ExtractionOptions {
  /** Graph createdAt. Supply a fixed value for reproducibility. */
  createdAt: UtcTimestamp;
  /** Graph id override; derived deterministically when omitted. */
  graphId?: string;
}

export interface ExtractionInput {
  sources: readonly SourceArtifact[];
  options: ExtractionOptions;
}

export interface LlmExtractor {
  /** Identity recorded in SemanticGraph.extractor for provenance. */
  readonly name: string;
  extract(input: ExtractionInput): Promise<SemanticGraph>;
}
