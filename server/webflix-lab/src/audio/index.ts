/**
 * Audio Overview pipeline (WFLX-W2, Stage 2) — public API.
 *
 * compileAudioOverview: OverviewPlan + SemanticGraph + sources
 *   -> DialogueGraph -> AudioTurn[] (text filled) -> speech -> alignment
 *   -> mix/master -> GeneratedArtifact + QA report.
 *
 * Determinism (DESIGN.md §10): identical (plan, graph, sources, seed, now,
 * provider, mastering backend) produce byte-identical outputs — turns,
 * manifest, artifact sidecar and WAV. `now` is REQUIRED (no hidden clock);
 * `recordLatency` is opt-in and makes the sidecar run-specific.
 *
 * The plan is turn-authoritative (§16.2): W2 validates, realizes text,
 * times, synthesizes, mixes and measures — it never adds, drops, reorders or
 * re-assigns turns. Hard validation failures throw AudioCompilerError; soft
 * quality problems surface in the QA report as typed issues naming the
 * smallest regenerable unit.
 */

import {
  validateOverviewPlan,
  type AudioTurn,
  type Id,
  type OverviewPlan,
  type SemanticGraph,
  type SourceArtifact,
  type UtcTimestamp,
} from '../contracts';
import type { SpeakerVoiceProfile, SpeechProvider, SpeechTurnRequest, SpeechTurnResult } from '../providers/audio/port';
import { AudioCompilerError } from './errors';
import { buildValidatedDialogueGraph } from './dialogue/engine';
import type { DialogueGraph } from './dialogue/types';
import { realizeDialogue, attachText, turnContentHash, type RealizedTurn, type RealizerContext } from './dialogue/text/realizer';
import { modeProfileFor } from './modes';
import { PACING_MULTIPLIERS } from './modes/common';
import { languagePackFor } from './modes/language-packs';
import { buildTimingManifest, retimingManifest, type TimingManifest } from './timing/manifest';
import type { GapPolicyInput } from './timing/timing';
import { mixTurns, masterTrack, type MasterOptions, type MasterResultOutput, type MasteringBackend } from './mixing/mix';
import { MASTER_SAMPLE_RATE } from './mixing/master';
import { selectSpeechProvider, type SpeechProviderChoice } from '../providers/audio/factory';
import { scanPronunciationRisks, risksToHints } from './qa/pronunciation';
import { runAudioQa, type AudioQaContext } from './qa/metrics';
import type { AudioQaReport } from './qa/report';
import { emitGeneratedArtifact } from './artifacts';
import type { GeneratedArtifact } from '../contracts';

export { AudioCompilerError } from './errors';
export type { DialogueValidationIssue } from './errors';
export { buildDialogueGraph, buildValidatedDialogueGraph, validateDialogueGraph, planHashOf, stableStringify } from './dialogue/engine';
export type { DialogueGraph, DialogueTurn, EnrichedTurnTag, SpeakerPersona, SpeakerStance, DialogueLinks, DialogueSection } from './dialogue/types';
export { ENRICHED_TAG_TO_PURPOSE, ZERO_CLAIM_ALLOWED_PURPOSES } from './dialogue/types';
export { realizeDialogue, realizeTurn, attachText, turnContentHash, enumerationOpenerFor } from './dialogue/text/realizer';
export type { RealizedTurn, RealizerContext } from './dialogue/text/realizer';
export { analyzeTurnTaking, TURN_TAKING_THRESHOLDS } from './dialogue/turn-taking';
export type { TurnTakingStats } from './dialogue/turn-taking';
export { buildTimingManifest, retimingManifest } from './timing/manifest';
export type { TimingManifest, TimingEntry } from './timing/manifest';
export { classifyBoundary, gapMsFor, GAP_POLICY, scaledGapBounds } from './timing/timing';
export type { BoundaryClass, GapPolicyInput } from './timing/timing';
export { mixTurns, masterTrack } from './mixing/mix';
export type { MixResult, MasterResultOutput, MasteringBackend, MasterOptions } from './mixing/mix';
export { measureIntegratedLufs, masterSamples, samplePeakDb, TARGET_LUFS, MASTER_SAMPLE_RATE, PEAK_CEILING } from './mixing/master';
export { encodeWavPcm16, decodeWav, resampleLinear, pcm16ToFloats } from './mixing/wav';
export { ffmpegAvailable, ffmpegVersion } from './mixing/ffmpeg';
export { runAudioQa, AUDIO_COMPILER_ID } from './qa/metrics';
export type { AudioQaContext } from './qa/metrics';
export type { AudioQaMetric, AudioQaStatus } from './qa/report';
export { toQaSummary } from './qa/report';
export { scanPronunciationRisks, risksToHints, numberToWords } from './qa/pronunciation';
export type { PronunciationRisk } from './qa/pronunciation';
export { emitGeneratedArtifact, deriveArtifactId } from './artifacts';
export { modeProfileFor } from './modes';

// ---------------------------------------------------------------------------
// Compile options and result
// ---------------------------------------------------------------------------

export interface CompileAudioOptions {
  /** Deterministic seed (required). Keys every stochastic choice. */
  readonly seed: string;
  /** Artifact createdAt (required — no hidden wall clock; inject a fixed value for reproducibility). */
  readonly now: UtcTimestamp;
  /** Speech provider instance; default: env-flag factory (offline unless WFLX_AUDIO_SPEECH_PROVIDER=gemini). */
  readonly provider?: SpeechProvider;
  /** Provider choice for the default factory ('offline' | 'gemini'). */
  readonly providerChoice?: SpeechProviderChoice;
  /** Mastering backend; default 'auto' (ffmpeg when on PATH, pure-TS otherwise). */
  readonly mastering?: MasteringBackend;
  /** Additionally emit MP3 (ffmpeg path only). */
  readonly mp3?: boolean;
  /** Override the deterministic artifact id. */
  readonly artifactId?: Id;
  /** Record provider latency in the sidecar (makes it run-specific; default false). */
  readonly recordLatency?: boolean;
  /** Mastering loudness target (default -16 LUFS). */
  readonly targetLufs?: number;
  /** Extra provenance notes. */
  readonly notes?: string;
}

export interface AudioOverviewResult {
  /** The compiled plan (pass-through, for convenience). */
  readonly plan: OverviewPlan;
  readonly graph: DialogueGraph;
  /** Script-level turns: plan turns with `text` filled (contract shape). */
  readonly turns: readonly AudioTurn[];
  readonly realized: readonly RealizedTurn[];
  readonly timing: TimingManifest;
  readonly synthesis: readonly SpeechTurnResult[];
  readonly master: MasterResultOutput;
  readonly qa: AudioQaReport;
  readonly artifact: GeneratedArtifact;
  readonly wav: Uint8Array;
  readonly mp3?: Uint8Array;
}

export interface CompileAudioOverviewInput {
  readonly plan: OverviewPlan;
  readonly graph: SemanticGraph;
  readonly sources: SourceArtifact | readonly SourceArtifact[];
  readonly options: CompileAudioOptions;
}

// ---------------------------------------------------------------------------
// The compiler
// ---------------------------------------------------------------------------

/** W1 deep validation at the audio boundary (defense in depth, §16.2 item 6). */
function deepValidatePlan(
  plan: OverviewPlan,
  graph: SemanticGraph,
  sources: readonly SourceArtifact[],
): void {
  const result = validateOverviewPlan(plan, graph, sources);
  if (!result.valid) {
    throw new AudioCompilerError(
      'invalid-plan',
      `plan failed W1 deep validation at the audio boundary: ${result.issues
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join('; ')}`,
      result.issues.map((issue) => ({ code: 'invalid-plan', path: issue.path, message: issue.message })),
    );
  }
}

/** Run the full audio overview pipeline. Throws AudioCompilerError on hard failures. */
export async function compileAudioOverview(
  input: CompileAudioOverviewInput,
): Promise<AudioOverviewResult> {
  const { plan, graph, options } = input;
  const sources = Array.isArray(input.sources) ? input.sources : [input.sources];

  deepValidatePlan(plan, graph, sources);

  // 1. Dialogue graph (zod guard + grounding validation inside).
  const dialogueGraph = buildValidatedDialogueGraph({ plan, graph, seed: options.seed });

  // 2. Text realization (seeded, budgeted, grounded).
  const profile = modeProfileFor(
    plan.mode as Parameters<typeof modeProfileFor>[0],
  );
  const language = languagePackFor(plan.language);
  const pacingMultiplier = PACING_MULTIPLIERS[plan.style.pacing ?? 'measured'] ?? 1.0;
  const realizerContext: RealizerContext = {
    plan,
    graph: dialogueGraph,
    claimIndex: new Map(graph.claims.map((claim) => [claim.id, claim])),
    beatIndex: new Map(plan.beats.map((beat) => [beat.id, beat])),
    profile,
    rate: profile.rate.wordsPerSecond * pacingMultiplier,
    languageId: language.id,
    languageFallback: language.fallback,
  };
  const realized = realizeDialogue(realizerContext);
  const turns = attachText(plan, realized);

  // 3. Speech synthesis (per turn: smallest regenerable unit semantics).
  const provider =
    options.provider ??
    selectSpeechProvider({ provider: options.providerChoice, seed: options.seed }).provider;
  const voices = new Map<string, SpeakerVoiceProfile>();
  for (const persona of dialogueGraph.personas) {
    voices.set(persona.speakerRole, {
      speakerId: persona.speakerRole,
      voice: persona.voice.voice,
      rate: persona.voice.rate,
      pitch: persona.voice.pitch,
      volume: persona.voice.volume,
      styleTags: [...persona.voice.styleTags],
    });
  }

  const synthesis: SpeechTurnResult[] = [];
  const preceding: { speakerId: string; text: string }[] = [];
  let speechLatencyMs = 0;
  for (const turn of dialogueGraph.turns) {
    const realizedTurn = realized.find((r) => r.turnId === turn.id);
    const text = realizedTurn?.text ?? '';
    const request: SpeechTurnRequest = {
      turnId: turn.id,
      speakerId: turn.speakerRole,
      text,
      ...(preceding.length > 0 ? { precedingDialogue: [...preceding].slice(-4) } : {}),
      targetSeconds: turn.targetDurationSeconds,
      pronunciationHints: risksToHints(scanPronunciationRisks(text)),
    };
    const startedAt = options.recordLatency === true ? performance.now() : 0;
    const result = await provider.synthesizeTurn(request, voices);
    if (options.recordLatency === true) {
      speechLatencyMs += Math.round(performance.now() - startedAt);
    }
    synthesis.push(result);
    preceding.push({ speakerId: turn.speakerRole, text });
  }

  // 4. Timing: pre-synthesis manifest, then retime with measured durations.
  // C-5: gap jitter keys on the gap-adjacent turns' content hashes (one
  // shared derivation with the realizer keys — turnContentHash above).
  const gapPolicy: GapPolicyInput = {
    seed: options.seed,
    turnContentHashes: dialogueGraph.turns.map((turn) => turnContentHash(realizerContext, turn)),
    gapScale: profile.gapScale,
  };
  const preManifest = buildTimingManifest(dialogueGraph, gapPolicy, MASTER_SAMPLE_RATE);
  const actualByTurn = new Map(synthesis.map((result) => [result.turnId, result.durationSeconds]));
  const manifest = retimingManifest(preManifest, actualByTurn);

  // 5. Mix + master.
  const masterOptions: MasterOptions = {
    backend: options.mastering,
    mp3: options.mp3,
    ...(options.targetLufs !== undefined ? { targetLufs: options.targetLufs } : {}),
  };
  const mix = mixTurns(
    synthesis.map((result) => ({ turnId: result.turnId, audio: result.audio })),
    manifest,
  );
  const master = masterTrack(mix, masterOptions);

  // 6. QA (deterministic metrics only).
  const qaContext: AudioQaContext = {
    plan,
    graph: dialogueGraph,
    realized,
    manifest,
    master,
    synthesis,
    profile,
    languageId: language.id,
    languageFallback: language.fallback,
  };
  const qa = runAudioQa(qaContext);

  // 7. Artifact + provenance sidecar.
  const artifact = emitGeneratedArtifact({
    plan,
    graph: dialogueGraph,
    manifest,
    master,
    qa,
    speechProviderId: provider.id,
    // WFLX-P1 (EV-016): public model identity for live-provider provenance;
    // absent (undefined) on the offline adapter — zero sidecar change there.
    ...(provider.modelId !== undefined ? { speechProviderModel: provider.modelId } : {}),
    // WFLX-P1 (EV-016, honesty rule): live remote providers are stochastic per
    // call (LAB-06 discipline) — the sidecar must never claim byte
    // reproducibility for live output. Offline deterministic stays true.
    ...(provider.kind !== 'offline-deterministic' ? { reproducible: false } : {}),
    ...(options.recordLatency === true ? { speechLatencyMs } : {}),
    now: options.now,
    ...(options.artifactId !== undefined ? { artifactId: options.artifactId } : {}),
    ...(options.notes !== undefined ? { notes: options.notes } : {}),
  });

  return {
    plan,
    graph: dialogueGraph,
    turns,
    realized,
    timing: manifest,
    synthesis,
    master,
    qa,
    artifact,
    wav: master.wav,
    ...(master.mp3 !== undefined ? { mp3: master.mp3 } : {}),
  };
}
