/**
 * WebFlix-Lab shared IR — ExperimentRecord.
 *
 * Mirrors docs/experiments/protocol.md (the YAML record template) flattened
 * to JSON, plus `evidenceKind` from the docs/evidence/README.md registry
 * convention. Field naming is camelCase across the IR; the legacy registry
 * (docs/evidence/registry.jsonl, TL-owned) keeps its own snake_case shape.
 *
 * Evidence-label discipline (AGENTS.md): observation strings SHOULD carry an
 * OBSERVED / DOCUMENTED / HYPOTHESIS / REPRODUCED / UNRESOLVED label, e.g.
 * "Golden reference identity pinned by SHA-256 (DOCUMENTED)." The guard
 * does not hard-fail on unlabelled observations; use hasEvidenceLabel() in
 * pipelines that want strictness.
 */

import { z } from 'zod';
import { ContractVersionSchema, UtcTimestampSchema } from './primitives';

export const EVIDENCE_LABELS = [
  'OBSERVED',
  'DOCUMENTED',
  'HYPOTHESIS',
  'REPRODUCED',
  'UNRESOLVED',
] as const;

export type EvidenceLabel = (typeof EVIDENCE_LABELS)[number];

export function hasEvidenceLabel(text: string): boolean {
  return /\b(OBSERVED|DOCUMENTED|HYPOTHESIS|REPRODUCED|UNRESOLVED)\b/.test(text);
}

export const ExperimentSurfaceSchema = z
  .enum(['audio', 'video', 'both'])
  .describe('Experiment surface.');

export type ExperimentSurface = z.infer<typeof ExperimentSurfaceSchema>;

export const ExperimentConfidenceSchema = z
  .enum(['low', 'medium', 'high'])
  .describe('Confidence in the hypothesis.');

export type ExperimentConfidence = z.infer<typeof ExperimentConfidenceSchema>;

export const ExperimentStatusSchema = z
  .enum([
    'supported',
    'weakened',
    'falsified',
    'unresolved',
    'documented',
    'reproduced',
    'unresolved-pending-operator',
  ])
  .describe('Hypothesis status; never silently promote HYPOTHESIS to fact.');

export type ExperimentStatus = z.infer<typeof ExperimentStatusSchema>;

export const EvidenceKindSchema = z
  .enum(['black-box-run', 'lab-reproduction', 'reference-import', 'integration-check'])
  .describe('Evidence kind, per the docs/evidence registry convention.');

export type EvidenceKind = z.infer<typeof EvidenceKindSchema>;

export const ExperimentRecordSchema = z
  .strictObject({
    recordType: z.literal('ExperimentRecord'),
    contractVersion: ContractVersionSchema,
    id: z.string().min(1).max(100).describe('Experiment id, e.g. "EXP-A-01".'),
    timestampUtc: UtcTimestampSchema,
    operator: z.string().min(1).max(100).describe('Operator identity, e.g. "tl2", "w1".'),
    surface: ExperimentSurfaceSchema,
    evidenceKind: EvidenceKindSchema,
    referenceNotebook: z.string().max(500).optional(),
    sourceFingerprint: z
      .string()
      .max(200)
      .optional()
      .describe('contentSha256 of the source (or combined sources).'),
    selectedSources: z
      .array(z.string().min(1))
      .readonly()
      .describe('Source identities selected for this run.'),
    format: z.string().min(1).max(200).describe('Requested overview format/mode.'),
    language: z.string().max(50).optional(),
    length: z.string().max(100).optional().describe('Requested length/duration.'),
    visualStyle: z.string().max(200).optional(),
    customPrompt: z.string().max(4000).optional(),
    otherConfig: z
      .record(z.string(), z.string())
      .readonly()
      .describe('Additional configuration, string-valued.'),
    baselineArtifact: z.string().max(300).optional(),
    mutation: z
      .string()
      .max(2000)
      .optional()
      .describe('The single changed variable (one-variable rule).'),
    artifactUnderTest: z.string().max(300).optional(),
    artifactHash: z.string().max(200).optional(),
    observations: z
      .array(z.string().min(1).max(4000))
      .readonly()
      .describe(
        'Each observation SHOULD carry an evidence label: OBSERVED / DOCUMENTED / ' +
          'HYPOTHESIS / REPRODUCED / UNRESOLVED.',
      ),
    invariants: z.array(z.string().min(1).max(4000)).readonly(),
    differences: z.array(z.string().min(1).max(4000)).readonly(),
    hypothesis: z.string().min(1).max(4000),
    confidence: ExperimentConfidenceSchema,
    falsifier: z
      .string()
      .min(1)
      .max(4000)
      .describe('What result would prove the hypothesis wrong.'),
    nextExperiment: z.string().min(1).max(300),
    status: ExperimentStatusSchema,
    evidencePaths: z
      .array(z.string().min(1))
      .min(1)
      .readonly()
      .describe('Files that prove this record.'),
  })
  .meta({ id: 'ExperimentRecord', title: 'ExperimentRecord' })
  .describe(
    'One black-box or lab-reproduction experiment record, per docs/experiments/protocol.md.',
  );

export type ExperimentRecord = z.infer<typeof ExperimentRecordSchema>;
