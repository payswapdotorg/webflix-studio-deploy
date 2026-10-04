/**
 * WebFlix-Lab shared IR — AudioTurn.
 *
 * One turn in a planned audio dialogue. At plan level (Worker 1) a turn
 * carries a speaker, an editorial purpose, grounded evidence and a target
 * duration; `brief` is the plan-level directive. The audio compiler
 * (Worker 2) fills `text` with the final narration script.
 *
 * DOCUMENTED Gemini Notebook audio formats (Deep Dive, Brief, Critique,
 * Debate) are two-person conversations for Deep Dive; the contract stays
 * mode-agnostic and lets the Director decide speaker count and pattern.
 */

import { z } from 'zod';
import { ContractVersionSchema, EvidenceSpanSchema, IdSchema } from './primitives';

export const SpeakerRoleSchema = z
  .enum(['host-a', 'host-b', 'guest', 'narrator'])
  .describe('Dialogue role of the speaker.');

export type SpeakerRole = z.infer<typeof SpeakerRoleSchema>;

export const AudioTurnPurposeSchema = z
  .enum([
    'framing',
    'question',
    'explanation',
    'example',
    'connection',
    'clarification',
    'interjection',
    'transition',
    'synthesis',
    'conclusion',
  ])
  .describe('Editorial purpose of the turn in the dialogue graph.');

export type AudioTurnPurpose = z.infer<typeof AudioTurnPurposeSchema>;

export const TurnStyleSchema = z
  .strictObject({
    delivery: z
      .string()
      .min(1)
      .max(300)
      .describe('Delivery direction for the speaker, e.g. "curious question".'),
    emphasis: z
      .string()
      .min(1)
      .max(300)
      .optional()
      .describe('Optional emphasis note, e.g. "land the number precisely".'),
  })
  .meta({ id: 'TurnStyle', title: 'TurnStyle' })
  .describe('Provider-neutral delivery style for one turn.');

export type TurnStyle = z.infer<typeof TurnStyleSchema>;

export const AudioTurnSchema = z
  .strictObject({
    recordType: z.literal('AudioTurn'),
    contractVersion: ContractVersionSchema,
    id: IdSchema,
    index: z.number().int().min(0).describe('Zero-based position in the turn sequence.'),
    speaker: z.string().min(1).max(100).describe('Display name, e.g. "Host A".'),
    speakerRole: SpeakerRoleSchema,
    purpose: AudioTurnPurposeSchema,
    brief: z
      .string()
      .min(1)
      .max(2000)
      .describe('Plan-level directive: what this turn must accomplish and stay grounded on.'),
    text: z
      .string()
      .max(8000)
      .optional()
      .describe('Final narration script; filled by the audio compiler, absent at plan level.'),
    claimIds: z.array(IdSchema).readonly().describe('Grounded claims this turn draws on.'),
    evidence: z
      .array(EvidenceSpanSchema)
      .readonly()
      .describe('Primary evidence backing this turn (usually the top span per claim).'),
    beatId: IdSchema.optional().describe('Narrative beat this turn belongs to.'),
    style: TurnStyleSchema,
    targetDurationSeconds: z
      .number()
      .positive()
      .describe('Planned duration of this turn in seconds.'),
  })
  .meta({ id: 'AudioTurn', title: 'AudioTurn' })
  .describe(
    'One planned audio dialogue turn. Plan level: brief + evidence + target duration. ' +
      'Script level (Worker 2): adds final text.',
  );

export type AudioTurn = z.infer<typeof AudioTurnSchema>;
