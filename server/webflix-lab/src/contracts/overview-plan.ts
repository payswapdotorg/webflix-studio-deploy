/**
 * WebFlix-Lab shared IR — OverviewPlan.
 *
 * The Overview Director's editorial plan for one overview artifact:
 * objective / audience / duration / coverage / narrative / style, plus
 * plan-level AudioTurn[] (audio modality) or VideoScene[] (video modality).
 * The plan is grounded: every referenced claimId must exist in the
 * SemanticGraph, and every graph claim must be editorially accounted for
 * (covered or omitted with a reason) — deep-validated in validation.ts.
 *
 * Mode vocabularies are DOCUMENTED Gemini Notebook formats:
 * audio: Deep Dive, Brief, Critique, Debate;
 * video: Explainer, Short, Cinematic.
 */

import { z } from 'zod';
import { AudioTurnSchema } from './audio-turn';
import {
  ContractVersionSchema,
  IdSchema,
  LanguageTagSchema,
  SemVerSchema,
  UtcTimestampSchema,
} from './primitives';
import { VideoSceneSchema } from './video-scene';

export const OverviewModalitySchema = z
  .enum(['audio', 'video'])
  .describe('Output modality of the planned overview.');

export type OverviewModality = z.infer<typeof OverviewModalitySchema>;

/** DOCUMENTED Gemini Notebook audio formats. */
export const AUDIO_OVERVIEW_MODES = ['deep-dive', 'brief', 'critique', 'debate'] as const;
export type AudioOverviewMode = (typeof AUDIO_OVERVIEW_MODES)[number];

/** DOCUMENTED Gemini Notebook video formats. */
export const VIDEO_OVERVIEW_MODES = ['explainer', 'short', 'cinematic'] as const;
export type VideoOverviewMode = (typeof VIDEO_OVERVIEW_MODES)[number];

export const AudioOverviewModeSchema = z
  .enum(AUDIO_OVERVIEW_MODES)
  .describe('DOCUMENTED Gemini Notebook audio format.');

export const VideoOverviewModeSchema = z
  .enum(VIDEO_OVERVIEW_MODES)
  .describe('DOCUMENTED Gemini Notebook video format.');

export const OverviewModeSchema = z
  .enum([...AUDIO_OVERVIEW_MODES, ...VIDEO_OVERVIEW_MODES])
  .describe(
    'Overview format. Must correlate with modality: audio plans use audio formats, ' +
      'video plans use video formats (enforced by the TypeScript runtime validator; ' +
      'JSON Schema consumers must enforce this application-side).',
  );

export type OverviewMode = z.infer<typeof OverviewModeSchema>;

export const AudienceLevelSchema = z
  .enum(['general', 'technical', 'executive', 'domain-expert'])
  .describe('Target audience level.');

export type AudienceLevel = z.infer<typeof AudienceLevelSchema>;

export const PlanStyleSchema = z
  .strictObject({
    tone: z
      .string()
      .min(1)
      .max(300)
      .describe('Tone direction, e.g. "curious, expert, conversational".'),
    register: z.string().min(1).max(300).optional().describe('Register, e.g. "plain-technical".'),
    pacing: z.enum(['measured', 'brisk', 'dynamic']).optional().describe('Pacing direction.'),
    speakerCount: z
      .number()
      .int()
      .min(1)
      .max(8)
      .optional()
      .describe('Speaker count for audio plans.'),
    styleBibleId: IdSchema.optional().describe('StyleBible reference for video plans (Worker 3 namespace).'),
  })
  .meta({ id: 'PlanStyle', title: 'PlanStyle' })
  .describe('Provider-neutral style directions for the plan.');

export type PlanStyle = z.infer<typeof PlanStyleSchema>;

export const CoverageEntrySchema = z
  .strictObject({
    claimId: IdSchema,
    role: z
      .enum(['primary', 'supporting', 'mention'])
      .describe('Editorial role of the claim in this plan.'),
    unitIds: z
      .array(IdSchema)
      .min(1)
      .readonly()
      .describe('Narrative units covering the claim (beat, turn or scene ids).'),
  })
  .meta({ id: 'CoverageEntry', title: 'CoverageEntry' })
  .describe('One covered claim and where it is covered.');

export type CoverageEntry = z.infer<typeof CoverageEntrySchema>;

export const OmittedClaimSchema = z
  .strictObject({
    claimId: IdSchema,
    reason: z
      .string()
      .min(1)
      .max(2000)
      .describe('Editorial reason for omission, e.g. "below salience threshold at 300 s".'),
  })
  .meta({ id: 'OmittedClaim', title: 'OmittedClaim' })
  .describe('One deliberately omitted claim and why.');

export type OmittedClaim = z.infer<typeof OmittedClaimSchema>;

export const CoverageMapSchema = z
  .strictObject({
    covered: z.array(CoverageEntrySchema).readonly(),
    omitted: z.array(OmittedClaimSchema).readonly(),
  })
  .meta({ id: 'CoverageMap', title: 'CoverageMap' })
  .describe(
    'Editorial accounting of every graph claim: covered or omitted with a reason ' +
      '(completeness is deep-validated against the SemanticGraph).',
  );

export type CoverageMap = z.infer<typeof CoverageMapSchema>;

export const NarrativeBeatSchema = z
  .strictObject({
    id: IdSchema,
    index: z.number().int().min(0).describe('Zero-based narrative order.'),
    title: z.string().min(1).max(300).describe('Short beat title.'),
    purpose: z.string().min(1).max(2000).describe('Editorial purpose of the beat.'),
    brief: z
      .string()
      .min(1)
      .max(4000)
      .describe('Narrative brief: what the beat communicates and how it flows.'),
    claimIds: z.array(IdSchema).readonly().describe('Grounded claims in this beat.'),
    topicIds: z.array(IdSchema).readonly().describe('Topics touched by this beat.'),
    weight: z
      .number()
      .positive()
      .max(1)
      .describe('Share of total duration in (0, 1]; beat weights must sum to 1 (deep-validated).'),
  })
  .meta({ id: 'NarrativeBeat', title: 'NarrativeBeat' })
  .describe('One narrative beat of the plan.');

export type NarrativeBeat = z.infer<typeof NarrativeBeatSchema>;

export const PlanGeneratorInfoSchema = z
  .strictObject({
    name: z.string().min(1).max(200).describe('Generator identity, e.g. "OverviewDirector@0.1.0".'),
    version: SemVerSchema,
    seed: z
      .string()
      .min(1)
      .max(200)
      .describe('Deterministic seed; identical inputs plus seed must reproduce the plan.'),
    deterministic: z
      .boolean()
      .describe('True when the generator is fully deterministic given the seed.'),
  })
  .meta({ id: 'PlanGeneratorInfo', title: 'PlanGeneratorInfo' })
  .describe('Reproducibility metadata for the plan.');

export type PlanGeneratorInfo = z.infer<typeof PlanGeneratorInfoSchema>;

const AUDIO_MODE_STRINGS = AUDIO_OVERVIEW_MODES as readonly string[];
const VIDEO_MODE_STRINGS = VIDEO_OVERVIEW_MODES as readonly string[];

export const OverviewPlanSchema = z
  .strictObject({
    recordType: z.literal('OverviewPlan'),
    contractVersion: ContractVersionSchema,
    id: IdSchema,
    sourceIds: z
      .array(IdSchema)
      .min(1)
      .readonly()
      .describe('SourceArtifacts the plan is grounded in.'),
    modality: OverviewModalitySchema,
    mode: OverviewModeSchema,
    objective: z
      .string()
      .min(1)
      .max(2000)
      .describe('One-line editorial objective of the overview.'),
    audience: AudienceLevelSchema,
    language: LanguageTagSchema,
    targetDurationSeconds: z
      .number()
      .positive()
      .describe('Target total duration in seconds.'),
    style: PlanStyleSchema,
    customInstructions: z
      .string()
      .max(4000)
      .optional()
      .describe('User-supplied custom instructions, if any.'),
    coverage: CoverageMapSchema,
    beats: z
      .array(NarrativeBeatSchema)
      .min(1)
      .readonly()
      .describe('Ordered narrative beats; the editorial spine of the overview.'),
    audioTurns: z
      .array(AudioTurnSchema)
      .readonly()
      .describe('Plan-level audio turns; required and non-empty for audio plans.'),
    videoScenes: z
      .array(VideoSceneSchema)
      .readonly()
      .describe('Plan-level video scenes; required and non-empty for video plans.'),
    generator: PlanGeneratorInfoSchema,
    createdAt: UtcTimestampSchema,
    notes: z.string().max(4000).optional().describe('Free-form plan notes.'),
  })
  .meta({ id: 'OverviewPlan', title: 'OverviewPlan' })
  .check((ctx) => {
    const { modality, mode, audioTurns, videoScenes } = ctx.value;
    if (modality === 'audio') {
      if (!AUDIO_MODE_STRINGS.includes(mode)) {
        ctx.issues.push({
          code: 'custom',
          message: 'audio plans require an audio mode (deep-dive | brief | critique | debate)',
          input: mode,
          path: ['mode'],
        });
      }
      if (videoScenes.length > 0) {
        ctx.issues.push({
          code: 'custom',
          message: 'audio plans must not carry videoScenes',
          input: videoScenes,
          path: ['videoScenes'],
        });
      }
      if (audioTurns.length === 0) {
        ctx.issues.push({
          code: 'custom',
          message: 'audio plans require at least one AudioTurn',
          input: audioTurns,
          path: ['audioTurns'],
        });
      }
    } else {
      if (!VIDEO_MODE_STRINGS.includes(mode)) {
        ctx.issues.push({
          code: 'custom',
          message: 'video plans require a video mode (explainer | short | cinematic)',
          input: mode,
          path: ['mode'],
        });
      }
      if (audioTurns.length > 0) {
        ctx.issues.push({
          code: 'custom',
          message: 'video plans must not carry audioTurns',
          input: audioTurns,
          path: ['audioTurns'],
        });
      }
      if (videoScenes.length === 0) {
        ctx.issues.push({
          code: 'custom',
          message: 'video plans require at least one VideoScene',
          input: videoScenes,
          path: ['videoScenes'],
        });
      }
    }
  })
  .describe(
    'The Overview Director editorial plan. Cross-field invariants (mode/modality, ' +
      'unit exclusivity) are enforced by the TypeScript runtime validator; duration and ' +
      'weight sums and coverage completeness are deep-validated in validation.ts.',
  );

export type OverviewPlan = z.infer<typeof OverviewPlanSchema>;
