/**
 * WebFlix-Lab shared IR — VideoScene.
 *
 * One planned scene in a video storyboard. Classification follows
 * docs/reference/reference-video-scene-atlas.md:
 * - exact labels, numbers, relationships and quotes render deterministically;
 * - illustration and metaphor render generatively;
 * - hybrid scenes combine both.
 * The contract stays provider-neutral: visualBrief is editorial intent, and
 * provider-specific asset requests live inside Worker 3's adapters.
 */

import { z } from 'zod';
import { ContractVersionSchema, IdSchema } from './primitives';

export const VisualTypeSchema = z
  .enum([
    'title-card',
    'architecture-diagram',
    'state-diagram',
    'process-flow',
    'data-chart',
    'code-panel',
    'quote-panel',
    'callout',
    'hero-illustration',
    'metaphor-illustration',
    'workstation-scene',
    'montage',
    'table',
  ])
  .describe('Visual type of the scene, per the reference scene atlas.');

export type VisualType = z.infer<typeof VisualTypeSchema>;

export const RenderingClassSchema = z
  .enum(['deterministic', 'generative', 'hybrid'])
  .describe(
    'Deterministic (exact labels/diagrams from structured facts), generative ' +
      '(illustration/metaphor) or hybrid, per the scene atlas reconstruction rules.',
  );

export type RenderingClass = z.infer<typeof RenderingClassSchema>;

export const SceneTextItemSchema = z
  .strictObject({
    role: z.enum(['title', 'label', 'number', 'quote', 'caption', 'code']),
    value: z.string().min(1).max(500).describe('The exact text value.'),
    exact: z
      .boolean()
      .describe('true = must be rendered exactly (deterministic); false = may be stylized.'),
  })
  .meta({ id: 'SceneTextItem', title: 'SceneTextItem' })
  .describe('One exact text element that must appear in the frame.');

export type SceneTextItem = z.infer<typeof SceneTextItemSchema>;

export const SceneMotionSchema = z
  .enum(['static', 'pan', 'zoom', 'parallax', 'animated-diagram'])
  .describe('Camera/motion intent; motion should emphasize transitions or relationships.');

export type SceneMotion = z.infer<typeof SceneMotionSchema>;

export const SceneTransitionSchema = z
  .enum(['cut', 'crossfade', 'wipe', 'push', 'morph'])
  .describe('Transition into this scene.');

export type SceneTransition = z.infer<typeof SceneTransitionSchema>;

export const VideoSceneSchema = z
  .strictObject({
    recordType: z.literal('VideoScene'),
    contractVersion: ContractVersionSchema,
    id: IdSchema,
    index: z.number().int().min(0).describe('Zero-based position in the scene sequence.'),
    beatId: IdSchema.optional().describe('Narrative beat this scene belongs to.'),
    narrativePurpose: z
      .string()
      .min(1)
      .max(2000)
      .describe('What this scene must explain; decoration alone is insufficient.'),
    visualType: VisualTypeSchema,
    renderingClass: RenderingClassSchema,
    exactTexts: z
      .array(SceneTextItemSchema)
      .readonly()
      .describe(
        'Exact text elements for the frame. Deterministic and hybrid scenes need at ' +
          'least one exact item (deep-validated per scene atlas rule 2).',
      ),
    claimIds: z.array(IdSchema).readonly().describe('Grounded claims this scene visualizes.'),
    narrationRef: IdSchema.optional().describe(
      'Reference to the narration segment covering this scene: an AudioTurn id in the ' +
        'same plan when audioTurns exist, otherwise a Worker-3 narration segment id.',
    ),
    narrationBrief: z
      .string()
      .min(1)
      .max(2000)
      .describe('Plan-level narration direction for this scene.'),
    targetDurationSeconds: z
      .number()
      .positive()
      .describe('Planned duration of this scene in seconds.'),
    motion: SceneMotionSchema,
    transition: SceneTransitionSchema,
    styleBibleId: IdSchema.optional().describe('StyleBible reference (Worker 3 namespace).'),
    visualBrief: z
      .string()
      .min(1)
      .max(2000)
      .optional()
      .describe('Editorial visual brief for generative components; provider-neutral.'),
  })
  .meta({ id: 'VideoScene', title: 'VideoScene' })
  .describe(
    'One planned video scene with narrative purpose, visual type, exact texts, and ' +
      'deterministic-vs-generative classification per the reference scene atlas.',
  );

export type VideoScene = z.infer<typeof VideoSceneSchema>;
