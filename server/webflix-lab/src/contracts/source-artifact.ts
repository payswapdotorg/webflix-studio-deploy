/**
 * WebFlix-Lab shared IR — SourceArtifact.
 *
 * A SourceArtifact is the normalized, provenance-carrying representation of
 * one authorized text source (markdown note, plain text, public article,
 * Substack, ...). It is the anchor for every evidence span in the IR: all
 * offsets index into `text` (UTF-16 code units, NFC-normalized).
 *
 * Block spans include their structural markdown markers (e.g. "# " or "- ");
 * consumers strip markers when they need semantic content. This keeps the
 * `block.text === text.slice(start, end)` invariant exact.
 */

import { z } from 'zod';
import {
  ContractVersionSchema,
  FingerprintSchema,
  IdSchema,
  LanguageTagSchema,
  SourceProvenanceSchema,
  UtcTimestampSchema,
} from './primitives';

export const BlockKindSchema = z
  .enum(['heading', 'paragraph', 'list-item', 'quote', 'code'])
  .describe('Structural kind of a source block.');

export type BlockKind = z.infer<typeof BlockKindSchema>;

/** One structural block of the source, anchored by exact offsets. */
export const SourceBlockSchema = z
  .strictObject({
    id: IdSchema,
    kind: BlockKindSchema,
    text: z
      .string()
      .min(1)
      .describe('Exact substring of the source text between start and end (markers included).'),
    start: z
      .number()
      .int()
      .min(0)
      .describe('Inclusive start offset in UTF-16 code units into the source text.'),
    end: z.number().int().min(0).describe('Exclusive end offset in UTF-16 code units.'),
    level: z
      .number()
      .int()
      .min(1)
      .max(6)
      .optional()
      .describe('Heading level; required when kind is "heading", forbidden otherwise.'),
  })
  .meta({ id: 'SourceBlock', title: 'SourceBlock' })
  .check((ctx) => {
    if (ctx.value.end <= ctx.value.start) {
      ctx.issues.push({
        code: 'custom',
        message: 'end must be greater than start',
        input: ctx.value.end,
        path: ['end'],
      });
    }
    if (ctx.value.kind === 'heading' && ctx.value.level === undefined) {
      ctx.issues.push({
        code: 'custom',
        message: 'heading blocks require level',
        input: ctx.value,
        path: ['level'],
      });
    }
    if (ctx.value.kind !== 'heading' && ctx.value.level !== undefined) {
      ctx.issues.push({
        code: 'custom',
        message: 'level is only allowed on heading blocks',
        input: ctx.value.level,
        path: ['level'],
      });
    }
  })
  .describe('One structural block of a source with exact offsets.');

export type SourceBlock = z.infer<typeof SourceBlockSchema>;

/** The normalized representation of one authorized text source. */
export const SourceArtifactSchema = z
  .strictObject({
    recordType: z.literal('SourceArtifact'),
    contractVersion: ContractVersionSchema,
    id: IdSchema,
    title: z.string().min(1).max(300).describe('Human-readable source title.'),
    provenance: SourceProvenanceSchema,
    fingerprint: FingerprintSchema,
    text: z
      .string()
      .min(1)
      .describe(
        'NFC-normalized canonical text. Every offset in the IR indexes into this string.',
      ),
    blocks: z
      .array(SourceBlockSchema)
      .min(1)
      .readonly()
      .describe('Structural blocks; ordered, non-overlapping (deep-validated).'),
    language: LanguageTagSchema,
    wordCount: z.number().int().min(1).describe('Whitespace-delimited word count of text.'),
    createdAt: UtcTimestampSchema,
    normalizer: z
      .string()
      .min(1)
      .max(200)
      .describe('Adapter identity that produced this artifact, e.g. "MarkdownNoteAdapter@0.1.0".'),
  })
  .meta({ id: 'SourceArtifact', title: 'SourceArtifact' })
  .describe(
    'Normalized, provenance-carrying representation of one authorized text source. ' +
      'Deep validators (validation.ts) additionally enforce block ordering/non-overlap, ' +
      'slice equality, word count and contentSha256 correctness.',
  );

export type SourceArtifact = z.infer<typeof SourceArtifactSchema>;
