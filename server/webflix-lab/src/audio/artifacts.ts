/**
 * Audio pipeline (WFLX-W2, Stage 2) — GeneratedArtifact + provenance sidecar.
 *
 * Emits the W1 contract record (src/contracts/generated-artifact.ts) — W2
 * invents no audio-side variant (DESIGN.md §16.1): media fingerprint with
 * sha256, provider usage per stage (speech / composition / evaluation),
 * generator info with seed + reproducible flag, and the QA summary. The
 * artifact id derives deterministically from (planHash, seed, provider,
 * mastering backend) unless overridden; a NEW id per generation is the
 * contract rule — reproducible regeneration reuses the same id on purpose
 * (byte-identical reproducibility) and never overwrites a golden reference.
 */

import { createHash } from 'node:crypto';
import {
  CONTRACTS_VERSION,
  GeneratedArtifactSchema,
  type GeneratedArtifact,
  type Id,
  type OverviewPlan,
  type ProviderUsage,
  type UtcTimestamp,
} from '../contracts';
import { AudioCompilerError } from './errors';
import type { DialogueGraph } from './dialogue/types';
import type { TimingManifest } from './timing/manifest';
import type { MasterResultOutput } from './mixing/mix';
import { MASTER_SAMPLE_RATE } from './mixing/master';
import type { AudioQaReport } from './qa/report';
import { toQaSummary } from './qa/report';
import { AUDIO_COMPILER_ID } from './qa/metrics';

export interface EmitArtifactInput {
  readonly plan: OverviewPlan;
  readonly graph: DialogueGraph;
  readonly manifest: TimingManifest;
  readonly master: MasterResultOutput;
  readonly qa: AudioQaReport;
  /** Provider-neutral speech provider identity (adapter id). */
  readonly speechProviderId: string;
  readonly speechProviderModel?: string;
  /** Honored only when recordLatency was enabled in the compile options. */
  readonly speechLatencyMs?: number;
  readonly now: UtcTimestamp;
  readonly artifactId?: Id;
  readonly notes?: string;
  /**
   * WFLX-P1 (EV-016, honesty rule): byte-reproducibility of the artifact.
   * Default true (the offline deterministic path). Live remote providers
   * are honestly stochastic per call (LAB-06 discipline) — callers pass
   * false so the sidecar never claims byte-identity for live output.
   */
  readonly reproducible?: boolean;
}

/** Deterministic default artifact id from the reproducibility key. */
export function deriveArtifactId(
  planHash: string,
  seed: string,
  speechProviderId: string,
  masteringBackend: string,
): Id {
  const digest = createHash('sha256')
    .update(`${planHash}|${seed}|${speechProviderId}|${masteringBackend}`)
    .digest('hex')
    .slice(0, 12);
  return `audio-overview-${digest}`;
}

/** Assemble + self-validate the GeneratedArtifact sidecar. */
export function emitGeneratedArtifact(input: EmitArtifactInput): GeneratedArtifact {
  const wavSha = createHash('sha256').update(input.master.wav).digest('hex');
  const artifactId =
    input.artifactId ??
    deriveArtifactId(
      input.graph.meta.planHash,
      input.graph.meta.seed,
      input.speechProviderId,
      input.master.backend,
    );
  const durationSeconds = input.manifest.totalDurationMs / 1000;

  const providers: ProviderUsage[] = [
    {
      stage: 'script',
      provider: 'wflx-dialogue-realizer',
      model: '0.1.0',
    },
    {
      stage: 'speech',
      provider: input.speechProviderId,
      ...(input.speechProviderModel !== undefined ? { model: input.speechProviderModel } : {}),
      ...(input.speechLatencyMs !== undefined ? { latencyMs: input.speechLatencyMs } : {}),
      // Offline deterministic path costs nothing — recorded honestly as zero.
      ...(input.speechProviderId === 'deterministic-offline-tts' ? { costUsd: 0 } : {}),
    },
    {
      stage: 'composition',
      provider: input.master.backend === 'ffmpeg' ? 'ffmpeg' : 'wflx-master-pure-ts',
      ...(input.master.backend === 'ffmpeg'
        ? { model: input.master.backendDetail }
        : { model: '0.1.0' }),
    },
    {
      stage: 'evaluation',
      provider: 'wflx-audio-qa',
      model: '0.1.0',
    },
  ];

  const notes =
    input.notes ??
    `Offline lab reconstruction; ${input.speechProviderId} speech is placeholder audio, NOT product parity evidence (AGENTS.md). ` +
      `Regenerate byte-identically with seed '${input.graph.meta.seed}' and the same inputs. ` +
      `Mastering: ${input.master.backendDetail}.`;

  const candidate: GeneratedArtifact = {
    recordType: 'GeneratedArtifact',
    contractVersion: CONTRACTS_VERSION,
    id: artifactId,
    kind: 'audio-overview',
    planId: input.plan.id,
    sourceIds: [...input.plan.sourceIds],
    createdAt: input.now,
    media: {
      container: 'wav',
      sha256: wavSha,
      sizeBytes: input.master.wav.byteLength,
      durationSeconds,
      audio: {
        codec: 'pcm_s16le',
        channels: 1,
        sampleRateHz: MASTER_SAMPLE_RATE,
      },
    },
    providers,
    generator: {
      name: AUDIO_COMPILER_ID,
      version: '0.1.0',
      seed: input.graph.meta.seed,
      reproducible: input.reproducible ?? true,
    },
    qa: toQaSummary(input.qa),
    notes,
  };

  const guard = GeneratedArtifactSchema.safeParse(candidate);
  if (!guard.success) {
    throw new AudioCompilerError(
      'invalid-artifact',
      `emitted artifact failed its contract guard: ${guard.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')}`,
    );
  }
  return guard.data;
}
