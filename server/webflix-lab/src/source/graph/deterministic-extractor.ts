/**
 * DeterministicExtractor (WFLX-W1, Stage 2).
 *
 * Rule-based, fully offline semantic graph extraction. No network, no API
 * keys, no ambient state: identical inputs produce byte-identical output.
 *
 * Rules (documented; HYPOTHESIS-labeled editorial priors where noted):
 * - Topics: one per H2 section (in document order). Title strips a
 *   "Section N — " prefix when present. Salience decays with section order.
 *   In a multi-source graph, topic ids are namespaced per source (same
 *   condition as claim ids) because section/source titles are not unique
 *   across sources.
 * - Entities: surfaces of list items, split on "/" into parts. Kind comes
 *   from a small lexicon plus suffix heuristics. Mentions = all exact
 *   occurrences of the surface in the source text.
 * - Claims: one per paragraph block and one per list-item block.
 *   Paragraph claims under a /purpose/i heading are kind "goal";
 *   paragraphs containing REDACTED markers are kind "constraint".
 *   Item salience decays with position (HYPOTHESIS prior).
 * - Relationships: slash-paired entities inside one list item are
 *   "related-to" with the item as same-line evidence (kind neutral: the
 *   rule cannot infer whether a slash means alternative, pairing or
 *   ownership — curated gold labels live in the hand-grounded fixture).
 */

import {
  CONTRACTS_VERSION,
  validateSemanticGraph,
  type ClaimRecord,
  type EntityKind,
  type EntityRecord,
  type EvidenceSpan,
  type Id,
  type RelationshipRecord,
  type SemanticGraph,
  type SourceArtifact,
  type SourceBlock,
  type TopicRecord,
} from '../../contracts';
import type { ExtractionInput, LlmExtractor } from './extractor';

export const DETERMINISTIC_EXTRACTOR_ID = 'DeterministicExtractor@0.1.0';

// --------------------------------------------------------------------------
// Lexicon + heuristics
// --------------------------------------------------------------------------

const LEXICON: { match: RegExp; kind: EntityKind }[] = [
  { match: /\bcloudflare\b/i, kind: 'infrastructure' },
  { match: /\bneon\b/i, kind: 'service' },
  { match: /\bvercel\b/i, kind: 'service' },
  { match: /\bgithub\b/i, kind: 'service' },
  { match: /\bpostgres(ql)?\b/i, kind: 'technology' },
  { match: /\bredis\b/i, kind: 'technology' },
  { match: /\bllm\b/i, kind: 'service' },
  { match: /\bbrowser automation\b/i, kind: 'technology' },
  { match: /\brealtime infrastructure\b/i, kind: 'infrastructure' },
  { match: /\bmulti-agent orchestration\b/i, kind: 'workflow' },
];

const SUFFIX_KINDS: { suffix: RegExp; kind: EntityKind }[] = [
  { suffix: /(tools|editors|generators)$/, kind: 'tool' },
  { suffix: /projects$/, kind: 'project' },
  { suffix: /(pipelines|integrations|audits|loops|workflows)$/, kind: 'process' },
  { suffix: /orchestration$/, kind: 'workflow' },
  { suffix: /(catalogs|limits|forecasting)$/, kind: 'concept' },
  { suffix: /infrastructure$/, kind: 'infrastructure' },
  { suffix: /generation$/, kind: 'technology' },
  { suffix: /(providers|services)$/, kind: 'service' },
];

function classifyEntity(name: string): EntityKind {
  for (const { match, kind } of LEXICON) {
    if (match.test(name)) return kind;
  }
  for (const { suffix, kind } of SUFFIX_KINDS) {
    if (suffix.test(name)) return kind;
  }
  return 'concept';
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'from', 'are', 'was', 'were', 'has',
  'have', 'had', 'not', 'but', 'all', 'can', 'will', 'would', 'should', 'into',
  'about', 'contains', 'contain', 'source', 'notes', 'note', 'discusses', 'discuss',
  'test', 'tests', 'when', 'they', 'them', 'its', 'their', 'there', 'these', 'those',
  'also', 'only', 'more', 'than', 'then', 'over', 'under', 'between', 'across',
]);

function keywordsOf(text: string, limit: number): string[] {
  const counts = new Map<string, number>();
  for (const word of text.toLowerCase().split(/[^a-z0-9-]+/)) {
    if (word.length < 4 || STOPWORDS.has(word)) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => (b[1] - a[1] !== 0 ? b[1] - a[1] : a[0].localeCompare(b[0])))
    .slice(0, limit)
    .map(([word]) => word);
}

// --------------------------------------------------------------------------
// Extraction
// --------------------------------------------------------------------------

function blockSpanOf(source: SourceArtifact, block: SourceBlock): EvidenceSpan {
  return {
    sourceId: source.id,
    blockId: block.id,
    start: block.start,
    end: block.end,
    quote: block.text,
  };
}

function surfaceSpan(source: SourceArtifact, block: SourceBlock, surface: string, at: number): EvidenceSpan {
  return {
    sourceId: source.id,
    blockId: block.id,
    start: at,
    end: at + surface.length,
    quote: surface,
  };
}

function blockContaining(source: SourceArtifact, start: number, end: number): SourceBlock | undefined {
  return source.blocks.find((b) => start >= b.start && end <= b.end);
}

/** Mutable entity accumulator; frozen into EntityRecords at the end. */
interface MutableEntity {
  id: Id;
  name: string;
  kind: EntityKind;
  mentions: EntityRecord['mentions'][number][];
}

/** All exact, non-overlapping occurrences of a surface as entity mentions. */
function mentionsOf(source: SourceArtifact, surface: string): EntityRecord['mentions'][number][] {
  const mentions: EntityRecord['mentions'][number][] = [];
  let from = 0;
  for (;;) {
    const at = source.text.indexOf(surface, from);
    if (at < 0) break;
    const end = at + surface.length;
    const block = blockContaining(source, at, end);
    if (block !== undefined) {
      mentions.push({
        sourceId: source.id,
        blockId: block.id,
        start: at,
        end,
        text: surface,
      });
    }
    from = at + surface.length;
  }
  return mentions;
}

function addEntity(entities: Map<Id, MutableEntity>, source: SourceArtifact, name: string): MutableEntity {
  const id = `entity-${slugify(name)}`;
  const existing = entities.get(id);
  if (existing !== undefined) {
    const known = new Set(existing.mentions.map((m) => `${m.sourceId}:${m.blockId}:${m.start}`));
    for (const mention of mentionsOf(source, name)) {
      const key = `${mention.sourceId}:${mention.blockId}:${mention.start}`;
      if (!known.has(key)) {
        existing.mentions.push(mention);
        known.add(key);
      }
    }
    return existing;
  }
  const mentions = mentionsOf(source, name);
  if (mentions.length === 0) {
    // Cannot happen (surfaces come from the text); guard for safety.
    throw new Error('entity surface not found in source (name redacted)');
  }
  const record: MutableEntity = {
    id,
    name,
    kind: classifyEntity(name),
    mentions,
  };
  entities.set(id, record);
  return record;
}

function freezeEntity(entity: MutableEntity): EntityRecord {
  return {
    recordType: 'EntityRecord',
    contractVersion: CONTRACTS_VERSION,
    id: entity.id,
    name: entity.name,
    kind: entity.kind,
    aliases: [],
    mentions: entity.mentions.slice().sort((a, b) => a.start - b.start),
  };
}

function claimOf(
  source: SourceArtifact,
  block: SourceBlock,
  statement: string,
  kind: ClaimRecord['kind'],
  salience: number,
  topicId: Id,
  entityIds: Id[],
  claimPrefix = '',
): ClaimRecord {
  return {
    recordType: 'ClaimRecord',
    contractVersion: CONTRACTS_VERSION,
    id: `claim-${claimPrefix}${block.id}`,
    statement,
    kind,
    evidence: [blockSpanOf(source, block)],
    entityIds,
    topicIds: [topicId],
    salience,
  };
}

function sectionTitleOf(block: SourceBlock): string {
  return block.text.replace(/^#+\s+/, '').replace(/^Section \d+\s+—\s+/, '');
}

export class DeterministicExtractor implements LlmExtractor {
  readonly name = DETERMINISTIC_EXTRACTOR_ID;

  async extract(input: ExtractionInput): Promise<SemanticGraph> {
    if (input.sources.length === 0) {
      throw new Error('DeterministicExtractor requires at least one source');
    }
    const { createdAt } = input.options;
    const sourceIds = input.sources.map((s) => s.id);
    // Claim ids derive from per-source block ids; topic ids derive from
    // section/source titles — neither is unique across sources, so both are
    // namespaced per source when multiple sources are extracted into one
    // graph (single-source ids stay unprefixed).
    const idPrefix =
      sourceIds.length > 1 ? (source: SourceArtifact) => `${slugify(source.id)}-` : () => '';
    const claimPrefix = idPrefix;
    const topicPrefix = idPrefix;
    const allClaims: ClaimRecord[] = [];
    const entityMap = new Map<Id, MutableEntity>();
    const relationships: RelationshipRecord[] = [];
    const topics: TopicRecord[] = [];

    for (const source of input.sources) {
      // Partition blocks into H2 sections (content before the first H2 joins
      // the first section's topic only if there is no H2 at all).
      const sections: { heading?: SourceBlock; blocks: SourceBlock[] }[] = [];
      let current: { heading?: SourceBlock; blocks: SourceBlock[] } = { blocks: [] };
      for (const block of source.blocks) {
        if (block.kind === 'heading' && block.level === 2) {
          if (current.heading !== undefined || current.blocks.length > 0) sections.push(current);
          current = { heading: block, blocks: [] };
        } else if (block.kind !== 'heading' || (block.level !== undefined && block.level > 2)) {
          current.blocks.push(block);
        }
      }
      sections.push(current);

      let sectionIndex = -1;
      for (const section of sections) {
        if (section.heading === undefined && section.blocks.length === 0) continue;
        sectionIndex += 1;
        const topicId =
          section.heading !== undefined
            ? `topic-${topicPrefix(source)}${slugify(sectionTitleOf(section.heading))}`
            : `topic-${topicPrefix(source)}${slugify(source.title)}`;
        const title = section.heading !== undefined ? sectionTitleOf(section.heading) : source.title;

        const sectionEntities = new Map<Id, MutableEntity>();
        const sectionClaims: ClaimRecord[] = [];
        let itemIndex = 0;

        for (const block of section.blocks) {
          if (block.kind === 'list-item') {
            const content = block.text.replace(/^[-*+]\s+/, '');
            const parts = content
              .split('/')
              .map((p) => p.trim())
              .filter((p) => p.length >= 2);
            const partEntities = parts.map((part) => addEntity(sectionEntities, source, part));
            for (const entity of partEntities) entityMap.set(entity.id, entity);
            // Slash-pair relationship with same-line evidence.
            for (let i = 0; i + 1 < partEntities.length; i += 1) {
              const a = partEntities[i] as MutableEntity;
              const b = partEntities[i + 1] as MutableEntity;
              if (a.id === b.id) continue;
              const relId = `rel-${a.id}-${b.id}`;
              if (relationships.some((r) => r.id === relId)) continue;
              relationships.push({
                recordType: 'RelationshipRecord',
                contractVersion: CONTRACTS_VERSION,
                id: relId,
                kind: 'related-to',
                subjectId: a.id,
                objectId: b.id,
                predicate: 'slash-paired with',
                evidence: [
                  surfaceSpan(source, block, content, block.start + block.text.indexOf(content)),
                ],
                claimIds: [],
              });
            }
            const statement =
              partEntities.length > 1
                ? `The ${title} list pairs ${partEntities.map((e) => e.name).join(' / ')}.`
                : `The ${title} list includes ${content}.`;
            const salience = Math.max(0.3, 0.7 - 0.05 * itemIndex);
            itemIndex += 1;
            sectionClaims.push(
              claimOf(source, block, statement, 'fact', salience, topicId, partEntities.map((e) => e.id), claimPrefix(source)),
            );
          } else if (block.kind === 'paragraph') {
            const isPurpose = /purpose/i.test(title);
            const kind: ClaimRecord['kind'] =
              isPurpose ? 'goal' : block.text.includes('[REDACTED]') ? 'constraint' : 'fact';
            const salience = isPurpose ? 0.9 : 0.8;
            // Entities are intentionally GLOBAL (shared across sources), but
            // a claim's entityIds must list entities mentioned in THIS
            // claim's evidence block — the mention match is scoped to the
            // (sourceId, blockId) pair so a foreign source's same-numbered
            // block cannot leak entities into the claim.
            const mentioned = [...entityMap.values()].filter((e) =>
              e.mentions.some((m) => m.sourceId === source.id && m.blockId === block.id),
            );
            sectionClaims.push(
              claimOf(
                source,
                block,
                block.text.length > 300 ? `${block.text.slice(0, 297)}...` : block.text,
                kind,
                salience,
                topicId,
                mentioned.map((e) => e.id),
                claimPrefix(source),
              ),
            );
          }
        }

        const firstParagraph = section.blocks.find((b) => b.kind === 'paragraph');
        const summary =
          firstParagraph !== undefined
            ? firstParagraph.text.slice(0, 300)
            : `Contains ${section.blocks.length} blocks.`;
        topics.push({
          recordType: 'TopicRecord',
          contractVersion: CONTRACTS_VERSION,
          id: topicId,
          title,
          summary,
          keywords: keywordsOf(
            section.blocks.map((b) => b.text).join(' '),
            5,
          ),
          claimIds: sectionClaims.map((c) => c.id),
          entityIds: [...sectionEntities.keys()],
          blockRefs: section.blocks.map((b) => ({ sourceId: source.id, blockId: b.id })),
          salience: Math.max(0.4, 0.9 - 0.05 * sectionIndex),
        });
        allClaims.push(...sectionClaims);
      }
    }

    // Attach relationship claimIds (claims whose evidence grounds in the
    // relationship's own evidence block). Block ids repeat per source, so the
    // match is scoped to the (sourceId, blockId) PAIR — blockId alone would
    // attach claims from a foreign source in multi-source graphs.
    for (const rel of relationships) {
      const anchor = rel.evidence[0];
      rel.claimIds = allClaims
        .filter((c) =>
          anchor !== undefined &&
          c.evidence.some(
            (span) => span.sourceId === anchor.sourceId && span.blockId === anchor.blockId,
          ),
        )
        .map((c) => c.id);
    }

    // Multi-source ids must stay unique; single-source is the tested path.
    const graphId =
      input.options.graphId ?? `graph-${sourceIds.map((id) => slugify(id)).join('-and-')}`;
    const graph: SemanticGraph = {
      recordType: 'SemanticGraph',
      contractVersion: CONTRACTS_VERSION,
      id: graphId,
      sourceIds,
      claims: allClaims,
      entities: [...entityMap.values()].map(freezeEntity),
      topics,
      relationships,
      extractor: DETERMINISTIC_EXTRACTOR_ID,
      createdAt,
    };

    const deep = validateSemanticGraph(graph, input.sources);
    if (!deep.valid) {
      throw new Error(`DeterministicExtractor produced an inconsistent graph: ${JSON.stringify(deep.issues)}`);
    }
    return graph;
  }
}
