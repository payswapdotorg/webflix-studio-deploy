/**
 * WebFlix-Lab shared IR — EntityRecord.
 *
 * An entity is a named thing from the source (tool, service, technology,
 * workflow, ...). Mentions are exact spans; block references carry both
 * sourceId and blockId so multi-source graphs stay unambiguous.
 */

import { z } from 'zod';
import { ContractVersionSchema, IdSchema } from './primitives';

export const EntityKindSchema = z
  .enum([
    'tool',
    'model',
    'service',
    'technology',
    'infrastructure',
    'concept',
    'workflow',
    'process',
    'project',
    'organization',
    'person',
    'metric',
    'other',
  ])
  .describe('Entity kind for visual-type and diagram decisions.');

export type EntityKind = z.infer<typeof EntityKindSchema>;

/** One exact surface occurrence of an entity in a source. */
export const EntityMentionSchema = z
  .strictObject({
    sourceId: IdSchema,
    blockId: IdSchema,
    start: z
      .number()
      .int()
      .min(0)
      .describe('Inclusive start offset in UTF-16 code units into the source text.'),
    end: z.number().int().min(0).describe('Exclusive end offset in UTF-16 code units.'),
    text: z
      .string()
      .min(1)
      .describe('Exact surface form at this mention; must equal source.text.slice(start, end).'),
  })
  .meta({ id: 'EntityMention', title: 'EntityMention' })
  .check((ctx) => {
    if (ctx.value.end <= ctx.value.start) {
      ctx.issues.push({
        code: 'custom',
        message: 'end must be greater than start',
        input: ctx.value.end,
        path: ['end'],
      });
    }
  })
  .describe('One exact surface occurrence of an entity.');

export type EntityMention = z.infer<typeof EntityMentionSchema>;

export const EntityRecordSchema = z
  .strictObject({
    recordType: z.literal('EntityRecord'),
    contractVersion: ContractVersionSchema,
    id: IdSchema,
    name: z.string().min(1).max(300).describe('Canonical entity name.'),
    kind: EntityKindSchema,
    aliases: z
      .array(z.string().min(1).max(300))
      .readonly()
      .describe('Alternate surface forms observed or known.'),
    mentions: z
      .array(EntityMentionSchema)
      .min(1)
      .readonly()
      .describe('Exact mentions in the sources; at least one is required.'),
    summary: z.string().max(2000).optional().describe('One-line entity summary.'),
  })
  .meta({ id: 'EntityRecord', title: 'EntityRecord' })
  .describe('A named entity with exact mention spans.');

export type EntityRecord = z.infer<typeof EntityRecordSchema>;
