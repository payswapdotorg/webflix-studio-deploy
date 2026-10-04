/**
 * WebFlix-Lab shared IR — TopicRecord.
 *
 * A topic groups claims, entities and source blocks thematically. Topics are
 * the Director's primary unit for beat construction and coverage mapping.
 */

import { z } from 'zod';
import { ContractVersionSchema, IdSchema } from './primitives';

/** An unambiguous reference to a block in a specific source. */
export const BlockRefSchema = z
  .strictObject({
    sourceId: IdSchema,
    blockId: IdSchema,
  })
  .meta({ id: 'BlockRef', title: 'BlockRef' })
  .describe('Reference to a SourceBlock in a specific SourceArtifact.');

export type BlockRef = z.infer<typeof BlockRefSchema>;

export const TopicRecordSchema = z
  .strictObject({
    recordType: z.literal('TopicRecord'),
    contractVersion: ContractVersionSchema,
    id: IdSchema,
    title: z.string().min(1).max(300).describe('Human-readable topic title.'),
    summary: z.string().min(1).max(2000).describe('One-to-two-sentence topic summary.'),
    keywords: z.array(z.string().min(1).max(100)).readonly().describe('Topic keywords.'),
    claimIds: z.array(IdSchema).readonly().describe('Claims belonging to this topic.'),
    entityIds: z.array(IdSchema).readonly().describe('Entities associated with this topic.'),
    blockRefs: z
      .array(BlockRefSchema)
      .readonly()
      .describe('Source blocks covered by this topic.'),
    salience: z
      .number()
      .min(0)
      .max(1)
      .describe('Editorial salience in [0, 1]; used by the Director for ranking.'),
  })
  .meta({ id: 'TopicRecord', title: 'TopicRecord' })
  .describe(
    'A thematic grouping of claims, entities and source blocks. Referential integrity ' +
      'is enforced by the SemanticGraph schema; blockRefs are deep-validated against sources.',
  );

export type TopicRecord = z.infer<typeof TopicRecordSchema>;
