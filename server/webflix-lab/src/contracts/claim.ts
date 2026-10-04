/**
 * WebFlix-Lab shared IR — ClaimRecord.
 *
 * A claim is a single source-grounded statement. Every claim must carry at
 * least one evidence span (quote + offsets) into a SourceArtifact. Claims are
 * the atomic unit of editorial coverage: OverviewPlans account for every
 * graph claim as covered or omitted.
 */

import { z } from 'zod';
import { ContractVersionSchema, EvidenceSpanSchema, IdSchema } from './primitives';

export const ClaimKindSchema = z
  .enum([
    'fact',
    'capability',
    'goal',
    'definition',
    'opinion',
    'relation',
    'process',
    'quantity',
    'constraint',
    'other',
  ])
  .describe('Editorial kind of the claim.');

export type ClaimKind = z.infer<typeof ClaimKindSchema>;

export const ClaimRecordSchema = z
  .strictObject({
    recordType: z.literal('ClaimRecord'),
    contractVersion: ContractVersionSchema,
    id: IdSchema,
    statement: z
      .string()
      .min(1)
      .max(2000)
      .describe('One-sentence declarative statement of the claim, grounded in evidence.'),
    kind: ClaimKindSchema,
    evidence: z
      .array(EvidenceSpanSchema)
      .min(1)
      .readonly()
      .describe('Evidence spans supporting the statement; at least one is required.'),
    entityIds: z.array(IdSchema).readonly().describe('Entities referenced by this claim.'),
    topicIds: z.array(IdSchema).readonly().describe('Topics this claim belongs to.'),
    salience: z
      .number()
      .min(0)
      .max(1)
      .describe('Editorial salience in [0, 1]; used by the Director for ranking.'),
    negated: z
      .boolean()
      .optional()
      .describe('True when the statement asserts absence or negation.'),
  })
  .meta({ id: 'ClaimRecord', title: 'ClaimRecord' })
  .describe(
    'A single source-grounded claim with evidence spans. Referential integrity ' +
      '(entityIds/topicIds resolve inside the SemanticGraph) is enforced by the graph schema.',
  );

export type ClaimRecord = z.infer<typeof ClaimRecordSchema>;
