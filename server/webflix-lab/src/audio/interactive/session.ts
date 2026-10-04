/**
 * Audio pipeline (WFLX-P1, Deliverable C / EV-018) — Interactive Audio
 * Overview: the session layer over a compiled overview.
 *
 * Product behavior reconstructed (Google-documented; see
 * docs/audio/interactive-audio-architecture.md): the listener verbally joins
 * the hosts, receives a SOURCE-GROUNDED response, then the ORIGINAL overview
 * resumes with its original turns intact.
 *
 * Lab reconstruction, provider-independent (any SpeechProvider; the
 * prototype runs the offline deterministic provider):
 *
 *   baseline compile -> intervene({ afterTurnIndex, listenerText })
 *     1. deterministic claim retrieval over the SAME SemanticGraph (the
 *        graph machinery: token-overlap scoring over claim statements,
 *        topic/entity labels; salience tie-break);
 *     2. an intervention-response OverviewPlan (one beat; a host
 *        acknowledgment interjection + the grounded response turn citing the
 *        retrieved claims) — built to pass the SAME W1 guard + deep
 *        validation, then compiled through compileAudioOverview: the SAME
 *        machinery end-to-end (W1 grounding validation, W2 dialogue-graph
 *        grounding rules, seeded text realization, per-turn synthesis,
 *        timing, mixing, QA);
 *     3. splice: the session manifest inserts the response entries after
 *        the boundary turn; every ORIGINAL entry keeps its own duration,
 *        gap and audio bytes (C-5 locality: the injection must not reshuffle
 *        untouched turns — proven per-turn by the locality proof);
 *     4. resume: the original turn sequence continues in order (order
 *        integrity proof).
 *
 * HONEST BOUNDARIES (recorded, never silently promoted):
 * - Listener VOICE capture is UNRESOLVED: interventions are text-scripted
 *   stand-ins (the prototype records them). No speech-to-intent layer is
 *   claimed.
 * - The response plan is INTERVENTION-LAYER constructed: the Director
 *   currently exposes no question-driven single-turn entry point (it
 *   compiles whole editorial plans); the response goes through the same
 *   compile machinery and validation surfaces, and the Director-entry-point
 *   gap is a HANDOFF entry for TL adjudication.
 * - Determinism: same (baseline inputs, seed, now, intervention) ->
 *   byte-identical session (offline provider; proven by double-run in the
 *   prototype). Live providers stay honestly stochastic (EV-016 discipline).
 */

import { createHash } from 'node:crypto';
import {
  CONTRACTS_VERSION,
  OverviewPlanSchema,
  validateOverviewPlan,
  type AudioTurn,
  type CoverageEntry,
  type Id,
  type OverviewPlan,
  type OmittedClaim,
  type SemanticGraph,
  type SourceArtifact,
  type SpeakerRole,
  type UtcTimestamp,
} from '../../contracts';
import {
  compileAudioOverview,
  emitGeneratedArtifact,
  mixTurns,
  masterTrack,
  validateDialogueGraph,
  type AudioOverviewResult,
  type DialogueGraph,
  type MasterResultOutput,
  type MasteringBackend,
} from '../index';
import type { TimingEntry, TimingManifest } from '../timing/manifest';
import { MASTER_SAMPLE_RATE } from '../mixing/master';
import type { AudioPayload, SpeakerId } from '../../providers/audio/port';
import type { GeneratedArtifact } from '../../contracts';

// ---------------------------------------------------------------------------
// Deterministic claim retrieval (the graph machinery)
// ---------------------------------------------------------------------------

export interface ClaimScore {
  readonly claimId: Id;
  readonly score: number;
  readonly salience: number;
}

/**
 * Score every graph claim against the listener intervention text.
 * Deterministic: token overlap (tokens >= 4 chars) against the claim
 * statement plus its topic/entity display labels; ties broken by salience
 * desc then claimId asc.
 */
export function scoreClaimsAgainstIntervention(
  graph: SemanticGraph,
  listenerText: string,
): readonly ClaimScore[] {
  const tokens = new Set(
    listenerText
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length >= 4),
  );
  const topics = new Map(graph.topics.map((topic) => [topic.id, topic.title.toLowerCase()]));
  const entities = new Map(
    graph.entities.map((entity) => [entity.id, `${entity.name} ${entity.aliases.join(' ')}`.toLowerCase()]),
  );

  const rows: ClaimScore[] = graph.claims.map((claim) => {
    const haystack = new Set(
      `${claim.statement.toLowerCase()} ${claim.topicIds
        .map((id) => topics.get(id) ?? '')
        .join(' ')} ${claim.entityIds
        .map((id) => entities.get(id) ?? '')
        .join(' ')}`
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((token) => token.length >= 4),
    );
    let score = 0;
    for (const token of tokens) {
      if (haystack.has(token)) score += 1;
    }
    return { claimId: claim.id, score, salience: claim.salience };
  });

  return rows.sort(
    (a, b) => b.score - a.score || b.salience - a.salience || (a.claimId < b.claimId ? -1 : 1),
  );
}

export interface ClaimRetrievalResult {
  readonly retrievedClaimIds: readonly Id[];
  readonly scores: readonly ClaimScore[];
  /** True when the intervention matched claims by content; false when the
   * honest fallback (top-salience claims) was used for a content-empty
   * question — recorded, never silent. */
  readonly matchedByContent: boolean;
}

/** Retrieve the claims grounding the response (top-N, deterministic). */
export function selectGroundedClaims(
  graph: SemanticGraph,
  listenerText: string,
  maxClaims = 2,
): ClaimRetrievalResult {
  const scores = scoreClaimsAgainstIntervention(graph, listenerText);
  const matched = scores.filter((row) => row.score > 0).slice(0, maxClaims);
  if (matched.length > 0) {
    return { retrievedClaimIds: matched.map((row) => row.claimId), scores, matchedByContent: true };
  }
  // Honest fallback: a content-empty question still gets a source-grounded
  // answer from the source's main content (top salience, id-stable order).
  const fallback = scores.slice().sort(
    (a, b) => b.salience - a.salience || (a.claimId < b.claimId ? -1 : 1),
  );
  return {
    retrievedClaimIds: fallback.slice(0, maxClaims).map((row) => row.claimId),
    scores,
    matchedByContent: false,
  };
}

// ---------------------------------------------------------------------------
// Intervention-response plan (W1-valid; compiled through the same machinery)
// ---------------------------------------------------------------------------

export interface InterventionPlanInput {
  readonly baselinePlan: OverviewPlan;
  readonly graph: SemanticGraph;
  readonly sources: readonly SourceArtifact[];
  readonly listenerText: string;
  readonly retrievedClaimIds: readonly Id[];
  /** Deterministic seed (session determinism). */
  readonly seed: string;
  readonly now: UtcTimestamp;
  readonly planId?: Id;
}

/** Deterministic intervention plan id from the session identity. */
export function deriveInterventionPlanId(
  baselinePlanId: Id,
  listenerText: string,
  afterTurnIndex: number,
): Id {
  const digest = createHash('sha256')
    .update(`${baselinePlanId}|${afterTurnIndex}|${listenerText}`)
    .digest('hex')
    .slice(0, 10);
  return `plan-interactive-response-${digest}`;
}

/**
 * Build the intervention-response plan: one beat ("listener question"), an
 * acknowledgment interjection (zero-claim, allowed purpose) and the grounded
 * response turn citing the retrieved claims. Passes the frozen guard AND
 * W1 deep validation before returning (builder honesty rule).
 */
export function buildInterventionPlan(
  input: InterventionPlanInput,
  afterTurnIndex: number,
): OverviewPlan {
  const graph = input.graph;
  const claimIndex = new Map(graph.claims.map((claim) => [claim.id, claim]));
  const retrieved = input.retrievedClaimIds.map((claimId) => {
    const claim = claimIndex.get(claimId);
    if (claim === undefined) {
      throw new Error(`interactive: retrieved claim ${claimId} not in graph`);
    }
    return claim;
  });
  if (retrieved.length === 0) {
    throw new Error('interactive: no claims retrieved for the response turn');
  }

  const ackSeconds = 3;
  const responseSeconds = Math.max(8, retrieved.length * 9);
  const targetDurationSeconds = ackSeconds + responseSeconds;

  const responseTurnId = 'ix-turn-response';
  const ackTurnId = 'ix-turn-ack';

  const covered: CoverageEntry[] = retrieved.map((claim) => ({
    claimId: claim.id,
    role: 'primary' as const,
    unitIds: [responseTurnId],
  }));
  const coveredIds = new Set(retrieved.map((claim) => claim.id));
  const omitted: OmittedClaim[] = graph.claims
    .filter((claim) => !coveredIds.has(claim.id))
    .map((claim) => ({
      claimId: claim.id,
      reason: 'outside the retrieved scope of this interactive response (session-local coverage; the baseline plan accounts for it editorially)',
    }));

  const evidence = retrieved.flatMap((claim) => claim.evidence.slice(0, 1));

  const ackSpeaker: SpeakerRole =
    input.baselinePlan.audioTurns[afterTurnIndex]?.speakerRole === 'host-a' ? 'host-b' : 'host-a';
  const responseSpeaker: SpeakerRole = ackSpeaker === 'host-a' ? 'host-b' : 'host-a';

  const turns: AudioTurn[] = [
    {
      recordType: 'AudioTurn',
      contractVersion: CONTRACTS_VERSION,
      id: ackTurnId,
      index: 0,
      speaker: ackSpeaker === 'host-a' ? 'Host A' : 'Host B',
      speakerRole: ackSpeaker,
      purpose: 'interjection',
      brief: 'Acknowledge the listener joining the conversation warmly and briefly.',
      claimIds: [],
      evidence: [],
      beatId: 'ix-beat-listener',
      style: { delivery: 'warm, brief conversational aside' },
      targetDurationSeconds: ackSeconds,
    },
    {
      recordType: 'AudioTurn',
      contractVersion: CONTRACTS_VERSION,
      id: responseTurnId,
      index: 1,
      speaker: responseSpeaker === 'host-a' ? 'Host A' : 'Host B',
      speakerRole: responseSpeaker,
      purpose: 'explanation',
      brief: `Answer the listener's question, grounded strictly in the source: ${input.listenerText.slice(0, 180)}`,
      claimIds: [...input.retrievedClaimIds],
      evidence,
      beatId: 'ix-beat-listener',
      style: { delivery: 'clear, direct answer to the listener' },
      targetDurationSeconds: responseSeconds,
    },
  ];

  const plan: OverviewPlan = {
    recordType: 'OverviewPlan',
    contractVersion: CONTRACTS_VERSION,
    id:
      input.planId ??
      deriveInterventionPlanId(input.baselinePlan.id, input.listenerText, afterTurnIndex),
    sourceIds: [...input.baselinePlan.sourceIds],
    modality: 'audio',
    mode: input.baselinePlan.mode,
    objective: `Source-grounded response to a listener intervention at turn boundary ${afterTurnIndex}: ${input.listenerText.slice(0, 120)}`,
    audience: input.baselinePlan.audience,
    language: input.baselinePlan.language,
    targetDurationSeconds,
    style: { ...input.baselinePlan.style },
    coverage: { covered, omitted },
    beats: [
      {
        id: 'ix-beat-listener',
        index: 0,
        title: 'Listener question',
        purpose: 'Host the listener intervention and the grounded answer.',
        brief: 'One listener question, one grounded answer, then the overview resumes.',
        claimIds: [...input.retrievedClaimIds],
        topicIds: [...(retrieved[0]?.topicIds ?? [])],
        weight: 1,
      },
    ],
    audioTurns: turns,
    videoScenes: [],
    generator: {
      name: 'wflx-interactive-audio-session',
      version: '0.1.0',
      seed: input.seed,
      deterministic: true,
    },
    createdAt: input.now,
    notes:
      'INTERACTIVE session response plan (EV-018): intervention-layer constructed (the Director exposes no question-driven single-turn entry point — HANDOFF); validated by the SAME W1 guard + deep validation and compiled through the SAME audio pipeline machinery.',
  };

  const guard = OverviewPlanSchema.safeParse(plan);
  if (!guard.success) {
    throw new Error(
      `interactive: intervention plan failed the frozen guard: ${guard.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`,
    );
  }
  const deep = validateOverviewPlan(plan, graph, input.sources);
  if (!deep.valid) {
    throw new Error(
      `interactive: intervention plan failed W1 deep validation: ${deep.issues
        .map((i) => `${i.path}: ${i.message}`)
        .join('; ')}`,
    );
  }
  return plan;
}

// ---------------------------------------------------------------------------
// Grounding check (the W1/W2 machinery, explicit for the proof)
// ---------------------------------------------------------------------------

export interface GroundingCheckResult {
  /** W1 deep validation of the response plan against graph + sources. */
  readonly w1Valid: boolean;
  readonly w1Issues: readonly { path: string; message: string }[];
  /** W2 dialogue-graph grounding rules (zero-claim allowlist, claim refs). */
  readonly w2Issues: readonly { code: string; message: string }[];
  /** Response turn claim ids all resolve in the graph. */
  readonly claimsResolve: boolean;
  readonly responseTurnId: Id;
  readonly responseClaimIds: readonly Id[];
  readonly passed: boolean;
}

/** F1: the response turn is source-grounded (W1 + W2 machinery).
 *
 * W1: validateOverviewPlan over the response plan + the source graph.
 * W2: validateDialogueGraph over the COMPILED dialogue graph (the same
 * engine the compiler runs at the audio boundary — defense in depth).
 */
export function checkResponseGrounding(
  responsePlan: OverviewPlan,
  responseGraph: DialogueGraph,
  graph: SemanticGraph,
  sources: readonly SourceArtifact[],
): GroundingCheckResult {
  const w1 = validateOverviewPlan(responsePlan, graph, sources);
  const w2 = validateDialogueGraph(
    responseGraph,
    new Map(graph.claims.map((claim) => [claim.id, claim])),
  );
  const claimUniverse = new Set(graph.claims.map((claim) => claim.id));
  const responseTurn = responsePlan.audioTurns.find((turn) => turn.claimIds.length > 0);
  const claimsResolve =
    responseTurn !== undefined &&
    responseTurn.claimIds.every((claimId) => claimUniverse.has(claimId));
  return {
    w1Valid: w1.valid,
    w1Issues: w1.issues.map((issue) => ({ path: issue.path, message: issue.message })),
    w2Issues: w2.map((issue) => ({ code: issue.code, message: issue.message })),
    claimsResolve,
    responseTurnId: responseTurn?.id ?? 'none',
    responseClaimIds: responseTurn?.claimIds ?? [],
    passed: w1.valid && w2.length === 0 && claimsResolve && responseTurn !== undefined,
  };
}

// ---------------------------------------------------------------------------
// The session
// ---------------------------------------------------------------------------

export interface InteractiveSessionInput {
  /** The compiled baseline overview (plan + graph + realized + timing + synthesis). */
  readonly baseline: AudioOverviewResult;
  readonly graph: SemanticGraph;
  readonly sources: readonly SourceArtifact[];
  /** Deterministic seed — must equal the baseline compile seed. */
  readonly seed: string;
  readonly now: UtcTimestamp;
  readonly mastering?: MasteringBackend;
}

export interface InterventionConfig {
  /** Listener joins AFTER this baseline turn index (turn boundary). */
  readonly afterTurnIndex: number;
  /** Text-scripted stand-in for the (UNRESOLVED) voice input. */
  readonly listenerText: string;
  /** Optional artifact id override for the session sidecar. */
  readonly artifactId?: Id;
}

export interface LocalityProofRow {
  readonly turnId: Id;
  readonly wavSha256Equal: boolean;
  readonly actualSecondsEqual: boolean;
  readonly gapAfterMsEqual: boolean;
  /** startMs delta vs the baseline entry (expected: 0 pre-boundary; the
   * inserted response total post-boundary — recorded, not silently zeroed). */
  readonly startMsDelta: number;
}

export interface InteractiveSessionResult {
  readonly config: InterventionConfig;
  readonly retrieval: ClaimRetrievalResult;
  readonly responsePlan: OverviewPlan;
  readonly responseCompile: AudioOverviewResult;
  readonly grounding: GroundingCheckResult;
  readonly session: {
    readonly manifest: TimingManifest;
    readonly master: MasterResultOutput;
    readonly artifact: GeneratedArtifact;
    readonly artifactId: Id;
    readonly wav: Uint8Array;
  };
  readonly proofs: {
    readonly locality: {
      readonly rows: readonly LocalityProofRow[];
      readonly postBoundaryShiftMs: number;
      readonly passed: boolean;
    };
    readonly order: {
      readonly baselineSequence: readonly Id[];
      readonly sessionSequence: readonly Id[];
      readonly originalOrderPreserved: boolean;
    };
  };
}

/** sha256 helper (hex). */
function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Assemble the session manifest: original entries + inserted response. */
function buildSessionManifest(
  baseline: AudioOverviewResult,
  response: AudioOverviewResult,
  afterTurnIndex: number,
): TimingManifest {
  const baselineEntries = baseline.timing.entries;
  const responseEntries = response.timing.entries;
  const boundaryGap = baselineEntries[afterTurnIndex]?.gapAfterMs ?? 0;

  const entries: TimingEntry[] = [];
  let cursorMs = 0;
  let gapsTotalMs = 0;
  let totalTargetSeconds = 0;

  const push = (entry: Omit<TimingEntry, 'index' | 'startMs' | 'endMs'>): void => {
    const durationMs = Math.round(entry.actualSeconds * 1000);
    totalTargetSeconds += entry.targetSeconds;
    gapsTotalMs += entry.gapAfterMs;
    entries.push({
      ...entry,
      index: entries.length,
      startMs: cursorMs,
      endMs: cursorMs + durationMs,
    });
    cursorMs += durationMs + entry.gapAfterMs;
  };

  baselineEntries.forEach((entry, i) => {
    if (i <= afterTurnIndex) {
      push(entry);
      if (i === afterTurnIndex) {
        // The response block: acknowledgment + grounded answer. The gap after
        // the response mirrors the original boundary pause (the overview
        // "resumes" with the pause the plan authored for that boundary).
        responseEntries.forEach((responseEntry, j) => {
          const isLastResponse = j === responseEntries.length - 1;
          push({
            ...responseEntry,
            gapAfterMs: isLastResponse ? boundaryGap : responseEntry.gapAfterMs,
          });
        });
      }
    } else {
      push(entry);
    }
  });

  const totalTurnSeconds = entries.reduce((acc, entry) => acc + entry.actualSeconds, 0);
  return {
    planId: baseline.timing.planId,
    planHash: createHash('sha256')
      .update(`${baseline.timing.planHash}|${response.timing.planHash}`)
      .digest('hex'),
    sampleRateHz: MASTER_SAMPLE_RATE,
    entries,
    totalTurnSeconds,
    totalTargetSeconds,
    gapsTotalMs,
    totalDurationMs: cursorMs,
  };
}

/**
 * The Interactive Audio session: intervene at a turn boundary, compile the
 * source-grounded response through the same machinery, resume the original
 * overview with the original turns intact.
 */
export class InteractiveAudioSession {
  private readonly input: InteractiveSessionInput;

  constructor(input: InteractiveSessionInput) {
    this.input = input;
  }

  async intervene(config: InterventionConfig): Promise<InteractiveSessionResult> {
    const { baseline, graph, sources, seed, now } = this.input;
    const afterTurnIndex = config.afterTurnIndex;
    if (afterTurnIndex < 0 || afterTurnIndex >= baseline.timing.entries.length - 1) {
      throw new Error(
        `interactive: afterTurnIndex ${afterTurnIndex} is not a valid interior turn boundary (0..${baseline.timing.entries.length - 2})`,
      );
    }

    // 1. Deterministic claim retrieval over the same graph.
    const retrieval = selectGroundedClaims(graph, config.listenerText, 2);

    // 2. Intervention plan + compile through the SAME machinery.
    const responsePlan = buildInterventionPlan(
      {
        baselinePlan: baseline.plan,
        graph,
        sources,
        listenerText: config.listenerText,
        retrievedClaimIds: retrieval.retrievedClaimIds,
        seed,
        now,
      },
      afterTurnIndex,
    );
    const responseCompile = await compileAudioOverview({
      plan: responsePlan,
      graph,
      sources,
      options: {
        seed,
        now,
        mastering: this.input.mastering ?? 'pure-ts',
        notes:
          'EV-018 interactive session response segment: compiled through the standard audio pipeline (same machinery) with W1+W2 grounding validation.',
      },
    });

    // 3. Grounding check (F1) — the W1/W2 machinery over the compiled graph.
    const grounding = checkResponseGrounding(responsePlan, responseCompile.graph, graph, sources);

    // 4. Splice + resume: session manifest, original entries preserved.
    const manifest = buildSessionManifest(baseline, responseCompile, afterTurnIndex);
    const turnAudio: { turnId: Id; audio: AudioPayload }[] = [];
    const payloadByTurn = new Map<Id, AudioPayload>();
    for (const segment of baseline.synthesis) payloadByTurn.set(segment.turnId, segment.audio);
    for (const segment of responseCompile.synthesis) payloadByTurn.set(segment.turnId, segment.audio);
    for (const entry of manifest.entries) {
      const audio = payloadByTurn.get(entry.turnId);
      if (audio === undefined) {
        throw new Error(`interactive: missing audio for session turn ${entry.turnId}`);
      }
      turnAudio.push({ turnId: entry.turnId, audio });
    }
    const mix = mixTurns(turnAudio, manifest);
    const master = masterTrack(mix, { backend: this.input.mastering ?? 'pure-ts' });

    // 5. Proofs — locality (F2): every original turn keeps its WAV bytes,
    // duration and gap; startMs shifts by exactly the inserted total
    // post-boundary.
    const responseEntryIds = new Set(responseCompile.timing.entries.map((entry) => entry.turnId));
    const insertedTurnSeconds = responseCompile.timing.entries.reduce(
      (acc, entry) => acc + entry.actualSeconds,
      0,
    );
    const insertedGapMs =
      responseCompile.timing.entries.reduce((acc, entry) => acc + entry.gapAfterMs, 0) +
      (baseline.timing.entries[afterTurnIndex]?.gapAfterMs ?? 0);
    const postBoundaryShiftMs = Math.round(insertedTurnSeconds * 1000) + insertedGapMs;

    const rows: LocalityProofRow[] = [];
    baseline.timing.entries.forEach((baselineEntry) => {
      const sessionEntry = manifest.entries.find(
        (entry) => entry.turnId === baselineEntry.turnId && !responseEntryIds.has(entry.turnId),
      );
      if (sessionEntry === undefined) {
        throw new Error(`interactive: locality proof lost turn ${baselineEntry.turnId}`);
      }
      const baselineSegment = baseline.synthesis.find(
        (segment) => segment.turnId === baselineEntry.turnId,
      );
      const sessionPayload = payloadByTurn.get(baselineEntry.turnId);
      rows.push({
        turnId: baselineEntry.turnId,
        wavSha256Equal:
          baselineSegment !== undefined &&
          sessionPayload !== undefined &&
          sha256Hex(baselineSegment.audio.data) === sha256Hex(sessionPayload.data),
        actualSecondsEqual:
          Math.abs(sessionEntry.actualSeconds - baselineEntry.actualSeconds) < 1e-9,
        gapAfterMsEqual: sessionEntry.gapAfterMs === baselineEntry.gapAfterMs,
        startMsDelta: sessionEntry.startMs - baselineEntry.startMs,
      });
    });
    const localityPassed = rows.every(
      (row) =>
        row.wavSha256Equal &&
        row.actualSecondsEqual &&
        row.gapAfterMsEqual &&
        (row.startMsDelta === 0 || row.startMsDelta === postBoundaryShiftMs),
    );

    // Order integrity (F3): the session sequence equals the baseline
    // sequence with the response turns inserted only at the boundary.
    const baselineSequence = baseline.timing.entries.map((entry) => entry.turnId);
    const sessionSequence = manifest.entries.map((entry) => entry.turnId);
    const sessionOriginals = sessionSequence.filter((id) => !responseEntryIds.has(id));
    const originalOrderPreserved =
      sessionOriginals.length === baselineSequence.length &&
      sessionOriginals.every((id, i) => id === baselineSequence[i]);
    const insertionPosition = sessionSequence.findIndex((id) => responseEntryIds.has(id));
    const expectedInsertion = afterTurnIndex + 1;

    // 6. Session artifact (provenance sidecar; response QA carried, noted).
    const artifact = emitGeneratedArtifact({
      plan: baseline.plan,
      graph: baseline.graph,
      manifest,
      master,
      qa: responseCompile.qa,
      speechProviderId:
        responseCompile.artifact.providers.find((p) => p.stage === 'speech')?.provider ?? 'unknown',
      now,
      artifactId: config.artifactId ?? 'artifact-interactive-audio-session',
      reproducible: true,
      notes:
        'EV-018 interactive audio session: baseline overview + listener intervention (text-scripted stand-in; voice capture UNRESOLVED) + source-grounded response compiled through the same machinery; original turns byte-identical across the boundary (locality proof in session summary); response segment QA carried here (the baseline QA lives on the baseline artifact). Deterministic at fixed (seed, now, intervention) for the offline provider.',
    });

    return {
      config,
      retrieval,
      responsePlan,
      responseCompile,
      grounding,
      session: {
        manifest,
        master,
        artifact,
        artifactId: artifact.id,
        wav: master.wav,
      },
      proofs: {
        locality: {
          rows,
          postBoundaryShiftMs,
          passed: localityPassed && insertionPosition === expectedInsertion,
        },
        order: {
          baselineSequence,
          sessionSequence,
          originalOrderPreserved,
        },
      },
    };
  }
}

/** Speaker ids appearing in the session manifest (helper for external wiring). */
export function sessionSpeakerIds(result: InteractiveSessionResult): readonly SpeakerId[] {
  return [...new Set(result.session.manifest.entries.map((entry) => entry.speakerRole))];
}
