/**
 * WebFlix-Lab shared IR — RelationshipRecord.
 *
 * A directed relationship between two entities (subject -> object) with
 * textual evidence. Relationships drive diagram scenes (architecture and
 * process visuals) and connection beats.
 */

import { z } from 'zod';
import { ContractVersionSchema, EvidenceSpanSchema, IdSchema } from './primitives';

export const RelationshipKindSchema = z
  .enum([
    'uses',
    'part-of',
    'depends-on',
    'integrates-with',
    'alternative-to',
    'produces',
    'manages',
    'secures',
    'monitors',
    'contrasts-with',
    'related-to',
    'other',
  ])
  .describe('Directed relationship kind.');

export type RelationshipKind = z.infer<typeof RelationshipKindSchema>;

export const RelationshipRecordSchema = z
  .strictObject({
    recordType: z.literal('RelationshipRecord'),
    contractVersion: ContractVersionSchema,
    id: IdSchema,
    kind: RelationshipKindSchema,
    subjectId: IdSchema.describe('Subject entity id.'),
    objectId: IdSchema.describe('Object entity id.'),
    predicate: z
      .string()
      .min(1)
      .max(200)
      .describe('Human phrase for the directed predicate, e.g. "alternative hosted form of".'),
    evidence: z
      .array(EvidenceSpanSchema)
      .min(1)
      .readonly()
      .describe(
        'Evidence spans supporting the relationship. Multi-span evidence means ' +
          'co-occurrence support (the spans jointly ground the relationship).',
      ),
    claimIds: z.array(IdSchema).readonly().describe('Claims that assert this relationship.'),
  })
  .meta({ id: 'RelationshipRecord', title: 'RelationshipRecord' })
  .check((ctx) => {
    if (ctx.value.subjectId === ctx.value.objectId) {
      ctx.issues.push({
        code: 'custom',
        message: 'subjectId and objectId must differ (no self-relationships)',
        input: ctx.value.subjectId,
        path: ['objectId'],
      });
    }
  })
  .describe('A directed, evidence-grounded relationship between two entities.');

export type RelationshipRecord = z.infer<typeof RelationshipRecordSchema>;
