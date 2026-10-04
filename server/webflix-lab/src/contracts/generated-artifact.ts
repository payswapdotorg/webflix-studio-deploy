/**
 * WebFlix-Lab shared IR — GeneratedArtifact.
 *
 * Provenance-rich record for one produced media artifact (audio or video
 * overview). Follows artifacts/README.md rules: a new id per generation,
 * never overwriting a golden reference, sha256 + provenance stored beside
 * media. Provider identities are provider-neutral strings; provider-specific
 * request/response structures stay inside adapters.
 */

import { z } from 'zod';
import {
  ContractVersionSchema,
  IdSchema,
  SemVerSchema,
  Sha256HexSchema,
  UtcTimestampSchema,
} from './primitives';

export const MediaContainerSchema = z
  .enum(['mp4', 'webm', 'm4a', 'mp3', 'wav', 'ogg'])
  .describe('Media container format.');

export type MediaContainer = z.infer<typeof MediaContainerSchema>;

export const AudioMediaSpecSchema = z
  .strictObject({
    codec: z.string().min(1).max(50),
    channels: z.number().int().min(1),
    sampleRateHz: z.number().int().min(1),
  })
  .meta({ id: 'AudioMediaSpec', title: 'AudioMediaSpec' })
  .describe('Audio stream specification.');

export type AudioMediaSpec = z.infer<typeof AudioMediaSpecSchema>;

export const VideoMediaSpecSchema = z
  .strictObject({
    codec: z.string().min(1).max(50),
    width: z.number().int().min(1),
    height: z.number().int().min(1),
    frameRate: z.number().positive(),
  })
  .meta({ id: 'VideoMediaSpec', title: 'VideoMediaSpec' })
  .describe('Video stream specification.');

export type VideoMediaSpec = z.infer<typeof VideoMediaSpecSchema>;

export const MediaInfoSchema = z
  .strictObject({
    container: MediaContainerSchema,
    sha256: Sha256HexSchema.describe('SHA-256 of the media file bytes.'),
    sizeBytes: z.number().int().min(0).describe('File size in bytes.'),
    durationSeconds: z.number().positive().describe('Measured duration in seconds.'),
    audio: AudioMediaSpecSchema.optional(),
    video: VideoMediaSpecSchema.optional(),
  })
  .meta({ id: 'MediaInfo', title: 'MediaInfo' })
  .describe('Media fingerprint of a generated artifact.');

export type MediaInfo = z.infer<typeof MediaInfoSchema>;

export const ProviderStageSchema = z
  .enum(['script', 'speech', 'image', 'video', 'composition', 'evaluation'])
  .describe('Compiler stage a provider served.');

export type ProviderStage = z.infer<typeof ProviderStageSchema>;

export const ProviderUsageSchema = z
  .strictObject({
    stage: ProviderStageSchema,
    provider: z
      .string()
      .min(1)
      .max(200)
      .describe('Provider-neutral identity, e.g. "gemini-tts", "deterministic-svg".'),
    model: z.string().min(1).max(200).optional(),
    latencyMs: z.number().int().min(0).optional(),
    costUsd: z.number().min(0).optional(),
  })
  .meta({ id: 'ProviderUsage', title: 'ProviderUsage' })
  .describe('Which provider served which stage, with optional cost/latency.');

export type ProviderUsage = z.infer<typeof ProviderUsageSchema>;

export const QaSeveritySchema = z
  .enum(['info', 'warning', 'error', 'blocker'])
  .describe('QA issue severity.');

export type QaSeverity = z.infer<typeof QaSeveritySchema>;

export const QaIssueSchema = z
  .strictObject({
    severity: QaSeveritySchema,
    code: z.string().min(1).max(100).describe('Stable issue code, e.g. "label-mismatch".'),
    message: z.string().min(1).max(2000),
    unitId: IdSchema.optional().describe('Smallest regenerable unit the issue belongs to.'),
  })
  .meta({ id: 'QaIssue', title: 'QaIssue' })
  .describe('One typed QA issue.');

export type QaIssue = z.infer<typeof QaIssueSchema>;

export const QaSummarySchema = z
  .strictObject({
    status: z.enum(['passed', 'passed-with-issues', 'failed', 'not-evaluated']),
    issues: z.array(QaIssueSchema).readonly(),
  })
  .meta({ id: 'QaSummary', title: 'QaSummary' })
  .describe('QA summary identifying the smallest regenerable unit per issue.');

export type QaSummary = z.infer<typeof QaSummarySchema>;

export const ArtifactGeneratorInfoSchema = z
  .strictObject({
    name: z.string().min(1).max(200),
    version: SemVerSchema,
    seed: z.string().min(1).max(200).optional(),
    reproducible: z.boolean(),
  })
  .meta({ id: 'ArtifactGeneratorInfo', title: 'ArtifactGeneratorInfo' })
  .describe('Generation provenance for the artifact.');

export type ArtifactGeneratorInfo = z.infer<typeof ArtifactGeneratorInfoSchema>;

export const GeneratedArtifactSchema = z
  .strictObject({
    recordType: z.literal('GeneratedArtifact'),
    contractVersion: ContractVersionSchema,
    /**
     * C-9 (v2 contract wave): the video surface's StyleBible bundle version
     * (Worker 3 namespace, src/video/style-bible.ts STYLE_BIBLE_VERSION),
     * emitted by the video compiler's manifest since 2.0.0 for full
     * reproducibility metadata (post-W3 audit e8ea606). Absent on audio
     * artifacts and on pre-v2 video artifacts (StyleBible is a
     * video-surface concept).
     */
    styleBibleVersion: SemVerSchema.optional().describe(
      'StyleBible bundle version the video surface realized against ' +
        '(video-overview only; absent pre-v2 and on audio artifacts).',
    ),
    id: IdSchema.describe('New id for every generation; never reuse or overwrite a golden reference.'),
    kind: z.enum(['audio-overview', 'video-overview']),
    planId: IdSchema.describe('OverviewPlan this artifact realizes.'),
    sourceIds: z.array(IdSchema).min(1).readonly(),
    createdAt: UtcTimestampSchema,
    media: MediaInfoSchema,
    providers: z
      .array(ProviderUsageSchema)
      .min(1)
      .readonly()
      .describe('At least one provider stage must be recorded.'),
    generator: ArtifactGeneratorInfoSchema,
    qa: QaSummarySchema.optional(),
    derivedFromArtifactId: IdSchema.optional().describe(
      'Lineage: artifact this one regenerates or refines.',
    ),
    notes: z.string().max(4000).optional(),
  })
  .meta({ id: 'GeneratedArtifact', title: 'GeneratedArtifact' })
  .check((ctx) => {
    const { kind, media } = ctx.value;
    if (kind === 'audio-overview' && media.audio === undefined) {
      ctx.issues.push({
        code: 'custom',
        message: 'audio-overview artifacts require media.audio',
        input: media,
        path: ['media', 'audio'],
      });
    }
    if (kind === 'video-overview' && media.video === undefined) {
      ctx.issues.push({
        code: 'custom',
        message: 'video-overview artifacts require media.video',
        input: media,
        path: ['media', 'video'],
      });
    }
  })
  .describe('One produced media artifact with full provenance and lineage.');

export type GeneratedArtifact = z.infer<typeof GeneratedArtifactSchema>;
