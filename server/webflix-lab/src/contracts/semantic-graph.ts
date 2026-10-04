/**
 * WebFlix-Lab shared IR — SemanticGraph (derived container).
 *
 * The frozen handoff list names ClaimRecord, EntityRecord, TopicRecord and
 * RelationshipRecord individually. SemanticGraph is the derived container
 * that binds them to their source ids; it is part of the freeze so that
 * Worker 2/3 and the Director share one aggregate shape without a
 * post-freeze contract addition. Its schema enforces within-graph
 * referential integrity; span-offset correctness against source text is
 * deep-validated in validation.ts.
 */

import { z } from 'zod';
import { ClaimRecordSchema } from './claim';
import { EntityRecordSchema } from './entity';
import { ContractVersionSchema, IdSchema, UtcTimestampSchema } from './primitives';
import { RelationshipRecordSchema } from './relationship';
import { TopicRecordSchema } from './topic';

function hasDuplicates(ids: readonly string[]): boolean {
  return new Set(ids).size !== ids.length;
}

export const SemanticGraphSchema = z
  .strictObject({
    recordType: z.literal('SemanticGraph'),
    contractVersion: ContractVersionSchema,
    id: IdSchema,
    sourceIds: z
      .array(IdSchema)
      .min(1)
      .readonly()
      .describe('SourceArtifacts this graph was extracted from.'),
    claims: z.array(ClaimRecordSchema).readonly(),
    entities: z.array(EntityRecordSchema).readonly(),
    topics: z.array(TopicRecordSchema).readonly(),
    relationships: z.array(RelationshipRecordSchema).readonly(),
    extractor: z
      .string()
      .min(1)
      .max(200)
      .describe('Extractor identity, e.g. "DeterministicExtractor@0.1.0".'),
    createdAt: UtcTimestampSchema,
  })
  .meta({ id: 'SemanticGraph', title: 'SemanticGraph' })
  .check((ctx) => {
    const { claims, entities, topics, relationships, sourceIds } = ctx.value;
    const claimIds = new Set(claims.map((c) => c.id));
    const entityIds = new Set(entities.map((e) => e.id));
    const topicIds = new Set(topics.map((t) => t.id));
    const sourceIdSet = new Set(sourceIds);

    if (hasDuplicates(claims.map((c) => c.id))) {
      ctx.issues.push({ code: 'custom', message: 'claim ids must be unique', input: claims });
    }
    if (hasDuplicates(entities.map((e) => e.id))) {
      ctx.issues.push({ code: 'custom', message: 'entity ids must be unique', input: entities });
    }
    if (hasDuplicates(topics.map((t) => t.id))) {
      ctx.issues.push({ code: 'custom', message: 'topic ids must be unique', input: topics });
    }
    if (hasDuplicates(relationships.map((r) => r.id))) {
      ctx.issues.push({ code: 'custom', message: 'relationship ids must be unique', input: relationships });
    }
    if (sourceIdSet.size !== sourceIds.length) {
      ctx.issues.push({ code: 'custom', message: 'sourceIds must be unique', input: sourceIds });
    }

    for (const claim of claims) {
      for (const entityId of claim.entityIds) {
        if (!entityIds.has(entityId)) {
          ctx.issues.push({
            code: 'custom',
            message: `claim ${claim.id} references unknown entity ${entityId}`,
            input: claim,
            path: ['claims'],
          });
        }
      }
      for (const topicId of claim.topicIds) {
        if (!topicIds.has(topicId)) {
          ctx.issues.push({
            code: 'custom',
            message: `claim ${claim.id} references unknown topic ${topicId}`,
            input: claim,
            path: ['claims'],
          });
        }
      }
      for (const span of claim.evidence) {
        if (!sourceIdSet.has(span.sourceId)) {
          ctx.issues.push({
            code: 'custom',
            message: `claim ${claim.id} evidence references unknown source ${span.sourceId}`,
            input: claim,
            path: ['claims'],
          });
        }
      }
    }
    for (const topic of topics) {
      for (const claimId of topic.claimIds) {
        if (!claimIds.has(claimId)) {
          ctx.issues.push({
            code: 'custom',
            message: `topic ${topic.id} references unknown claim ${claimId}`,
            input: topic,
            path: ['topics'],
          });
        }
      }
      for (const entityId of topic.entityIds) {
        if (!entityIds.has(entityId)) {
          ctx.issues.push({
            code: 'custom',
            message: `topic ${topic.id} references unknown entity ${entityId}`,
            input: topic,
            path: ['topics'],
          });
        }
      }
      for (const ref of topic.blockRefs) {
        if (!sourceIdSet.has(ref.sourceId)) {
          ctx.issues.push({
            code: 'custom',
            message: `topic ${topic.id} references unknown source ${ref.sourceId}`,
            input: topic,
            path: ['topics'],
          });
        }
      }
    }
    for (const rel of relationships) {
      if (!entityIds.has(rel.subjectId)) {
        ctx.issues.push({
          code: 'custom',
          message: `relationship ${rel.id} references unknown subject entity ${rel.subjectId}`,
          input: rel,
          path: ['relationships'],
        });
      }
      if (!entityIds.has(rel.objectId)) {
        ctx.issues.push({
          code: 'custom',
          message: `relationship ${rel.id} references unknown object entity ${rel.objectId}`,
          input: rel,
          path: ['relationships'],
        });
      }
      for (const claimId of rel.claimIds) {
        if (!claimIds.has(claimId)) {
          ctx.issues.push({
            code: 'custom',
            message: `relationship ${rel.id} references unknown claim ${claimId}`,
            input: rel,
            path: ['relationships'],
          });
        }
      }
      for (const span of rel.evidence) {
        if (!sourceIdSet.has(span.sourceId)) {
          ctx.issues.push({
            code: 'custom',
            message: `relationship ${rel.id} evidence references unknown source ${span.sourceId}`,
            input: rel,
            path: ['relationships'],
          });
        }
      }
    }
    for (const entity of entities) {
      for (const mention of entity.mentions) {
        if (!sourceIdSet.has(mention.sourceId)) {
          ctx.issues.push({
            code: 'custom',
            message: `entity ${entity.id} mention references unknown source ${mention.sourceId}`,
            input: entity,
            path: ['entities'],
          });
        }
      }
    }
  })
  .describe(
    'Derived aggregate container binding claims, entities, topics and relationships ' +
      'to their sources. Enforces within-graph referential integrity and id uniqueness.',
  );

export type SemanticGraph = z.infer<typeof SemanticGraphSchema>;
