/**
 * Retrieval API over the semantic graph (WFLX-W1, Stage 2).
 *
 * Simple span/evidence lookup used by the groundedness evaluator, the
 * Director and (later) Workers 2 and 3 for evidence-aware compilation.
 * Read-only and deterministic.
 */

import type {
  ClaimRecord,
  EntityRecord,
  EvidenceSpan,
  Id,
  RelationshipRecord,
  SemanticGraph,
  SourceArtifact,
  TopicRecord,
} from '../../contracts';

export class GraphIndex {
  private readonly claimsById = new Map<Id, ClaimRecord>();
  private readonly entitiesById = new Map<Id, EntityRecord>();
  private readonly topicsById = new Map<Id, TopicRecord>();
  private readonly claimsByTopic = new Map<Id, ClaimRecord[]>();
  private readonly claimsByEntity = new Map<Id, ClaimRecord[]>();
  private readonly relsByEntity = new Map<Id, RelationshipRecord[]>();
  private readonly sourcesById = new Map<Id, SourceArtifact>();

  constructor(
    public readonly graph: SemanticGraph,
    sources: readonly SourceArtifact[],
  ) {
    for (const claim of graph.claims) this.claimsById.set(claim.id, claim);
    for (const entity of graph.entities) this.entitiesById.set(entity.id, entity);
    for (const topic of graph.topics) this.topicsById.set(topic.id, topic);
    for (const source of sources) this.sourcesById.set(source.id, source);

    for (const claim of graph.claims) {
      for (const topicId of claim.topicIds) {
        const list = this.claimsByTopic.get(topicId) ?? [];
        list.push(claim);
        this.claimsByTopic.set(topicId, list);
      }
      for (const entityId of claim.entityIds) {
        const list = this.claimsByEntity.get(entityId) ?? [];
        list.push(claim);
        this.claimsByEntity.set(entityId, list);
      }
    }
    for (const rel of graph.relationships) {
      for (const entityId of [rel.subjectId, rel.objectId]) {
        const list = this.relsByEntity.get(entityId) ?? [];
        list.push(rel);
        this.relsByEntity.set(entityId, list);
      }
    }
  }

  get sources(): readonly SourceArtifact[] {
    return [...this.sourcesById.values()];
  }

  getClaim(id: Id): ClaimRecord | undefined {
    return this.claimsById.get(id);
  }

  getEntity(id: Id): EntityRecord | undefined {
    return this.entitiesById.get(id);
  }

  getTopic(id: Id): TopicRecord | undefined {
    return this.topicsById.get(id);
  }

  sourceOf(span: EvidenceSpan): SourceArtifact | undefined {
    return this.sourcesById.get(span.sourceId);
  }

  claimsByTopicId(topicId: Id): readonly ClaimRecord[] {
    return this.claimsByTopic.get(topicId) ?? [];
  }

  claimsByEntityId(entityId: Id): readonly ClaimRecord[] {
    return this.claimsByEntity.get(entityId) ?? [];
  }

  entitiesInClaim(claimId: Id): readonly EntityRecord[] {
    const claim = this.claimsById.get(claimId);
    if (claim === undefined) return [];
    return claim.entityIds
      .map((id) => this.entitiesById.get(id))
      .filter((e): e is EntityRecord => e !== undefined);
  }

  relationshipsForEntity(entityId: Id): readonly RelationshipRecord[] {
    return this.relsByEntity.get(entityId) ?? [];
  }

  /** All evidence spans of a claim, in record order. */
  evidenceForClaim(claimId: Id): readonly EvidenceSpan[] {
    return this.claimsById.get(claimId)?.evidence ?? [];
  }

  /**
   * Verify one span against its source text (the grounding invariant).
   * Returns null when the span verifies; otherwise a human-readable issue.
   */
  verifySpan(span: EvidenceSpan): string | null {
    const source = this.sourcesById.get(span.sourceId);
    if (source === undefined) return `unknown source ${span.sourceId}`;
    const block = source.blocks.find((b) => b.id === span.blockId);
    if (block === undefined) return `unknown block ${span.blockId}`;
    if (span.start < block.start || span.end > block.end) {
      return `span [${span.start}, ${span.end}) escapes block ${block.id}`;
    }
    const sliced = source.text.slice(span.start, span.end);
    if (sliced !== span.quote) return 'quote does not equal text.slice(start, end)';
    return null;
  }

  /** Expanded context around a span (for prompts and debugging). */
  quoteContext(span: EvidenceSpan, radiusChars = 80): string {
    const source = this.sourcesById.get(span.sourceId);
    if (source === undefined) return '';
    const start = Math.max(0, span.start - radiusChars);
    const end = Math.min(source.text.length, span.end + radiusChars);
    return source.text.slice(start, end);
  }

  /**
   * Case-insensitive substring search over claim statements and evidence
   * quotes. Results ordered by salience (desc) then id (asc).
   */
  searchClaims(query: string): readonly ClaimRecord[] {
    const q = query.trim().toLowerCase();
    if (q.length === 0) return [];
    return this.graph.claims
      .filter(
        (claim) =>
          claim.statement.toLowerCase().includes(q) ||
          claim.evidence.some((span) => span.quote.toLowerCase().includes(q)),
      )
      .sort((a, b) => (b.salience - a.salience !== 0 ? b.salience - a.salience : a.id.localeCompare(b.id)));
  }

  /** All claims ordered by salience (desc), ties broken by id (asc). */
  rankedClaims(): readonly ClaimRecord[] {
    return [...this.graph.claims].sort((a, b) =>
      b.salience - a.salience !== 0 ? b.salience - a.salience : a.id.localeCompare(b.id),
    );
  }
}
