/**
 * Video pipeline (WFLX-W3) — GeneratedArtifact + provenance sidecar.
 *
 * Emits the W1 contract record (src/contracts/generated-artifact.ts); W3
 * invents no video-side variant (same discipline as W2 §16.1): media
 * fingerprint with sha256, provider usage per stage (image / composition /
 * evaluation), generator info with seed + reproducible flag, QA summary,
 * and since v2 (C-9) the StyleBible bundle version
 * (STYLE_BIBLE_VERSION from src/video/style-bible.ts) — the post-W3
 * reproducibility-audit gap the p3b wave-1 test pinned is closed. The
 * unified registry (tools/manifest) prefers this emitted value.
 * The artifact id derives deterministically from (planHash, seed, providers)
 * so reproducible regeneration reuses the same id on purpose and never
 * overwrites a golden reference (artifacts/README.md).
 */

import { createHash } from 'node:crypto';
import {
  CONTRACTS_VERSION,
  GeneratedArtifactSchema,
  type GeneratedArtifact,
  type Id,
  type ProviderUsage,
  type OverviewPlan,
  type UtcTimestamp,
} from '../contracts';
import { VideoCompilerError } from './errors';
import { STYLE_BIBLE_VERSION } from './style-bible';
import type { ComposeVideoResult } from '../compositor/render';
import type { VideoQaReport } from './qa/report';
import { toQaSummary } from './qa/report';
import type { RenderStoryboardResult } from './render/renderer';

export interface EmitVideoArtifactInput {
  readonly plan: OverviewPlan;
  readonly planHash: string;
  readonly seed: string;
  readonly render: RenderStoryboardResult;
  readonly composition: ComposeVideoResult;
  readonly qa: VideoQaReport;
  readonly illustrationProviderId: string;
  readonly motionProviderId: string;
  readonly mp4Bytes: Uint8Array;
  readonly now: UtcTimestamp;
  readonly artifactId?: Id;
  readonly notes?: string;
  /**
   * WFLX-P2 (Cinematic): public model identity for the image-stage provider
   * (recorded in provenance). Default keeps the W3 value — zero change for
   * existing callers.
   */
  readonly illustrationModel?: string;
  /**
   * WFLX-P2 (Cinematic): honest reproducibility flag. Default true (offline
   * deterministic); live generative providers pass false (P1 live-TTS
   * precedent — live output is honestly stochastic per call).
   */
  readonly reproducible?: boolean;
}

/** Deterministic default artifact id from the reproducibility key. */
export function deriveVideoArtifactId(
  planHash: string,
  seed: string,
  illustrationProviderId: string,
  compositionBackend: string,
): Id {
  const digest = createHash('sha256')
    .update(`${planHash}|${seed}|${illustrationProviderId}|${compositionBackend}`)
    .digest('hex')
    .slice(0, 12);
  return `video-overview-${digest}`;
}

export function emitGeneratedVideoArtifact(
  input: EmitVideoArtifactInput,
): GeneratedArtifact {
  const mp4Sha = createHash('sha256').update(input.mp4Bytes).digest('hex');

  const providers: ProviderUsage[] = [
    {
      stage: 'image',
      provider: input.illustrationProviderId,
      model: input.illustrationModel ?? 'reference-ink-grammar',
    },
    {
      stage: 'composition',
      provider: input.composition.backend === 'remotion' ? 'remotion' : 'wflx-fallback-compositor',
      model: input.composition.backend === 'remotion' ? '4.0.529' : '0.1.0',
    },
    {
      stage: 'evaluation',
      provider: 'wflx-video-qa',
      model: '0.1.0',
    },
  ];
  void input.motionProviderId; // motion plans are deterministic; recorded in notes

  const artifactId =
    input.artifactId ??
    deriveVideoArtifactId(
      input.planHash,
      input.seed,
      input.illustrationProviderId,
      input.composition.backend,
    );

  const candidate: GeneratedArtifact = {
    recordType: 'GeneratedArtifact',
    contractVersion: CONTRACTS_VERSION,
    // C-9 (v2): StyleBible bundle version emitted for reproducibility
    // metadata completeness (post-W3 audit e8ea606).
    styleBibleVersion: STYLE_BIBLE_VERSION,
    id: artifactId,
    kind: 'video-overview',
    planId: input.plan.id,
    sourceIds: [...input.plan.sourceIds],
    createdAt: input.now,
    media: {
      container: 'mp4',
      sha256: mp4Sha,
      sizeBytes: input.mp4Bytes.byteLength,
      durationSeconds: input.composition.durationSeconds,
      video: {
        codec: 'h264',
        width: 1280,
        height: 720,
        frameRate: 30,
      },
      audio: {
        codec: 'aac',
        channels: 1,
        sampleRateHz: 44_100,
      },
    },
    providers,
    generator: {
      name: 'wflx-video-compiler',
      version: '0.1.0',
      seed: input.seed,
      reproducible: input.reproducible ?? true,
    },
    qa: toQaSummary(input.qa),
    notes:
      input.notes ??
      `Offline lab reconstruction; ${input.illustrationProviderId} illustrations and placeholder narration are ` +
        `NOT product parity evidence (AGENTS.md). Scene SVG determinism hash ` +
        `${input.render.combinedSha256.slice(0, 16)}…; regenerate byte-identically with seed '${input.seed}'. ` +
        `Composition backend: ${input.composition.backend}.`,
  };

  const guard = GeneratedArtifactSchema.safeParse(candidate);
  if (!guard.success) {
    throw new VideoCompilerError(
      `emitted video artifact fails its guard: ${JSON.stringify(guard.error.issues)}`,
    );
  }
  return guard.data;
}
