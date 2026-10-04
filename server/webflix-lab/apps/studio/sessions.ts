/**
 * WebFlix-Lab Operator Studio (WFLX-UI2) — the Interactive Audio session
 * boundary.
 *
 * This module drives the REAL machinery — `InteractiveAudioSession` +
 * `intervene()` from src/audio/interactive/session.ts — over a compiled
 * baseline retained by the studio store (see pipeline.ts StoredOverview). It
 * NEVER re-implements retrieval, plan construction, compilation, splicing,
 * or proof evaluation; it constructs the session with the stored baseline
 * inputs, calls intervene(), and serializes the InteractiveSessionResult
 * into the studio's HTTP DTOs.
 *
 * SESSION SEMANTICS (as the machinery defines them — never invented here):
 * - each intervene() run FORKS from the stored baseline (lab fork-and-compare
 *   semantics; the product's cumulative multi-turn chat is NOT imitated —
 *   every response carries the honest label);
 * - afterTurnIndex must be an INTERIOR boundary (0..baseline.turns-2) — only
 *   valid boundaries are surfaced;
 * - listener input is the documented TYPED text-scripted stand-in (voice
 *   capture UNRESOLVED — no microphone anything, ever).
 *
 * REGISTRY LAW: the session registry is an in-memory Map on the studio
 * context (per server instance). A restart resets sessions, compiled
 * overviews, and session masters — accepted, documented, never hidden
 * (SESSION_PERSISTENCE_NOTE rides every session response).
 *
 * Evidence class: REPRODUCED (lab implementation; AGENTS.md).
 */

import { createHash } from 'node:crypto';
import { InteractiveAudioSession, type InteractiveSessionResult } from '../../src/audio/interactive/session';
import {
  StudioValidationError,
  type StoredOverview,
  type StoredSession,
  type StudioContext,
} from './pipeline';
import {
  SESSION_FORK_SEMANTICS,
  SESSION_LISTENER_INPUT_MODE,
  SESSION_PERSISTENCE_NOTE,
  type SessionEstablishResponse,
  type SessionGroundingClaim,
  type SessionInterveneResponse,
  type SessionInterventionSummary,
  type SessionLocalityRow,
  type SessionStateResponse,
  type SessionTurnRow,
} from './api/types';

const SAME_MACHINERY_NOTE =
  'response segment compiled through compileAudioOverview (the same machinery) with the ' +
  'intervention-layer plan — W1 deep validation + W2 dialogue-graph grounding rules; the ' +
  'Director exposes no question-driven single-turn entry point (recorded HANDOFF, never ' +
  're-implemented around)';

const LOCALITY_INVARIANT_LINE = 'post-boundary shift == inserted response total';

// ---------------------------------------------------------------------------
// Valid boundaries (interior turn indexes only — the machinery's contract)
// ---------------------------------------------------------------------------

/** Interior intervention boundaries: 0..turnCount-2 (empty when < 2 turns). */
export function validBoundariesFor(turnCount: number): number[] {
  const boundaries: number[] = [];
  for (let index = 0; index <= turnCount - 2; index += 1) {
    boundaries.push(index);
  }
  return boundaries;
}

// ---------------------------------------------------------------------------
// POST /api/session — establish (join) a session over a stored baseline
// ---------------------------------------------------------------------------

/**
 * Join an interactive session over the STORED overview result. Joining the
 * same baseline again is idempotent: the registry entry is reused and the
 * join counter increments (fork history is preserved).
 */
export function establishSession(
  ctx: StudioContext,
  overviewId: string,
): SessionEstablishResponse {
  const baseline = ctx.store.get(overviewId);
  if (baseline === undefined) {
    throw new StudioValidationError(
      'unknown-overview',
      `no compiled overview for id '${overviewId}' on this server instance — compile first via POST /api/overview`,
      { overviewId },
    );
  }

  const existing = [...ctx.sessions.values()].find(
    (candidate) => candidate.overviewId === overviewId,
  );
  if (existing !== undefined) {
    existing.joins += 1;
    return establishResponseOf(existing);
  }

  ctx.sessionSeq += 1;
  const sessionId = `ix-session-${ctx.sessionSeq}`;
  // THE wiring: the machinery over the stored baseline inputs. The seed must
  // equal the baseline compile seed (session determinism law).
  const session = new InteractiveAudioSession({
    baseline: baseline.result,
    graph: baseline.graph,
    sources: baseline.sources,
    seed: baseline.seed,
    now: baseline.now,
    mastering: baseline.mastering,
  });
  const stored: StoredSession = {
    sessionId,
    overviewId,
    session,
    seed: baseline.seed,
    now: baseline.now,
    mastering: baseline.mastering,
    turnCount: baseline.result.timing.entries.length,
    joins: 1,
    interventions: [],
  };
  ctx.sessions.set(sessionId, stored);
  return establishResponseOf(stored);
}

function establishResponseOf(stored: StoredSession): SessionEstablishResponse {
  return {
    sessionId: stored.sessionId,
    overviewId: stored.overviewId,
    turnCount: stored.turnCount,
    validBoundaries: validBoundariesFor(stored.turnCount),
    joins: stored.joins,
    semantics: SESSION_FORK_SEMANTICS,
    listenerInputMode: SESSION_LISTENER_INPUT_MODE,
    persistenceNote: SESSION_PERSISTENCE_NOTE,
    evidenceClass: 'REPRODUCED',
  };
}

// ---------------------------------------------------------------------------
// POST /api/session/:id/intervene — fork + compile the grounded response
// ---------------------------------------------------------------------------

/**
 * Ask a TYPED listener question at a turn boundary: validates the boundary
 * against the session's valid interior set (typed 4xx on violation), then
 * drives session.intervene() — the machinery. The returned session master is
 * registered in the session-audio store under its OWN artifact id (never the
 * baseline's) and served by the existing /audio/:id/master.wav endpoint.
 */
export async function interveneOnSession(
  ctx: StudioContext,
  sessionId: string,
  afterTurnIndex: unknown,
  listenerText: unknown,
): Promise<SessionInterveneResponse> {
  const stored = requireSession(ctx, sessionId);
  const baseline = ctx.store.get(stored.overviewId);
  if (baseline === undefined) {
    throw new StudioValidationError(
      'unknown-overview',
      `the baseline overview '${stored.overviewId}' is no longer in the in-memory store (server restart resets everything)`,
      { overviewId: stored.overviewId },
    );
  }

  // Typed validation (4xx) BEFORE the machinery runs.
  if (
    typeof afterTurnIndex !== 'number' ||
    !Number.isInteger(afterTurnIndex) ||
    !validBoundariesFor(stored.turnCount).includes(afterTurnIndex)
  ) {
    throw new StudioValidationError(
      'invalid-boundary',
      `afterTurnIndex must be an integer interior turn boundary (0..${stored.turnCount - 2} for this baseline's ${stored.turnCount} turns; got '${String(afterTurnIndex)}')`,
      { afterTurnIndex, turnCount: stored.turnCount },
    );
  }
  if (typeof listenerText !== 'string' || listenerText.trim().length === 0) {
    throw new StudioValidationError(
      'empty-listener-text',
      'listenerText must be a non-empty string (typed stand-in — voice capture UNRESOLVED; no microphone is faked)',
      {},
    );
  }

  const seq = stored.interventions.length + 1;
  const forkId = `${sessionId}-fork-${seq}`;
  const artifactId = `artifact-${forkId}`;

  // THE machinery call — never re-implemented here.
  const result = await stored.session.intervene({
    afterTurnIndex,
    listenerText,
    artifactId,
  });

  // Register the session master under its OWN artifact id (never the
  // baseline's) for the existing WAV endpoint pattern.
  ctx.sessionAudio.set(result.session.artifactId, {
    wav: result.session.wav,
    sessionId,
    artifactId: result.session.artifactId,
  });

  const response = serializeIntervention(stored, baseline, result, seq, forkId);
  stored.interventions.push(response);
  return response;
}

// ---------------------------------------------------------------------------
// GET /api/session/:id — current session state
// ---------------------------------------------------------------------------

export function sessionStateOf(ctx: StudioContext, sessionId: string): SessionStateResponse {
  const stored = requireSession(ctx, sessionId);
  return {
    sessionId: stored.sessionId,
    overviewId: stored.overviewId,
    joins: stored.joins,
    turnCount: stored.turnCount,
    validBoundaries: validBoundariesFor(stored.turnCount),
    semantics: SESSION_FORK_SEMANTICS,
    listenerInputMode: SESSION_LISTENER_INPUT_MODE,
    persistenceNote: SESSION_PERSISTENCE_NOTE,
    evidenceClass: 'REPRODUCED',
    interventions: stored.interventions.map(interventionSummaryOf),
  };
}

function interventionSummaryOf(record: SessionInterveneResponse): SessionInterventionSummary {
  return {
    interventionId: record.interventionId,
    interventionSeq: record.interventionSeq,
    afterTurnIndex: record.afterTurnIndex,
    listenerText: record.listenerText,
    insertedTurnIds: record.insertedTurnIds,
    sessionArtifactId: record.sessionMaster.artifactId,
    sessionMasterSha256: record.sessionMaster.sha256,
    groundingPassed: record.grounding.passed,
    localityPassed: record.locality.passed,
    originalOrderPreserved: record.locality.originalOrderPreserved,
  };
}

// ---------------------------------------------------------------------------
// Serialization — a pure projection of InteractiveSessionResult (no invention)
// ---------------------------------------------------------------------------

function serializeIntervention(
  stored: StoredSession,
  baseline: StoredOverview,
  result: InteractiveSessionResult,
  seq: number,
  forkId: string,
): SessionInterveneResponse {
  const manifest = result.session.manifest;
  const insertedIds = new Set(result.responseCompile.timing.entries.map((entry) => entry.turnId));

  const baselineRowByTurn = new Map(baseline.response.transcript.map((row) => [row.turnId, row]));
  const responseRealizedByTurn = new Map(result.responseCompile.realized.map((row) => [row.turnId, row]));
  const responsePurposeByTurn = new Map(result.responsePlan.audioTurns.map((turn) => [turn.id, turn.purpose]));
  // Speaker display names come from the baseline DIALOGUE graph personas (the
  // same hosts W1's transcript renders) — the response turns are the same hosts.
  const personaNames = new Map<string, string>(
    baseline.result.graph.personas.map((persona) => [persona.speakerRole, persona.displayName]),
  );

  // Timeline: the session manifest (original order preserved, response turns
  // inserted at the boundary) projected turn by turn.
  const timeline: SessionTurnRow[] = manifest.entries.map((entry, sessionIndex) => {
    const inserted = insertedIds.has(entry.turnId);
    const baselineRow = baselineRowByTurn.get(entry.turnId);
    const realized = responseRealizedByTurn.get(entry.turnId);
    return {
      turnId: entry.turnId,
      sessionIndex,
      baselineIndex: inserted ? null : (baselineRow?.index ?? null),
      speakerRole: entry.speakerRole,
      speakerName: personaNames.get(entry.speakerRole) ?? entry.speakerRole,
      purpose: inserted
        ? (responsePurposeByTurn.get(entry.turnId) ?? 'listener-response')
        : (baselineRow?.purpose ?? 'unknown'),
      text: inserted ? (realized?.text ?? '') : (baselineRow?.text ?? ''),
      wordCount: inserted ? (realized?.wordCount ?? 0) : (baselineRow?.wordCount ?? 0),
      startMs: entry.startMs,
      endMs: entry.endMs,
      durationMs: entry.endMs - entry.startMs,
      gapAfterMs: entry.gapAfterMs,
      inserted,
    };
  });

  // Locality rows: the machinery's proof rows joined with the baseline index
  // (for pre/post-boundary classification) and startMs values.
  const baselineStartByTurn = new Map(
    baseline.result.timing.entries.map((entry) => [entry.turnId, entry.startMs]),
  );
  const sessionStartByTurn = new Map(
    manifest.entries
      .filter((entry) => !insertedIds.has(entry.turnId))
      .map((entry) => [entry.turnId, entry.startMs]),
  );
  const localityRows: SessionLocalityRow[] = result.proofs.locality.rows.map((row, index) => ({
    turnId: row.turnId,
    baselineIndex: index,
    wavSha256Equal: row.wavSha256Equal,
    actualSecondsEqual: row.actualSecondsEqual,
    gapAfterMsEqual: row.gapAfterMsEqual,
    baselineStartMs: baselineStartByTurn.get(row.turnId) ?? 0,
    sessionStartMs: sessionStartByTurn.get(row.turnId) ?? 0,
    startMsDelta: row.startMsDelta,
    postBoundary: index > result.config.afterTurnIndex,
  }));

  // The §7 invariant, recomputed INDEPENDENTLY from the serialized timeline
  // (inserted turns + their gaps) and cross-checked against the machinery's
  // postBoundaryShiftMs and the per-row deltas.
  const insertedTotalMs = timeline
    .filter((row) => row.inserted)
    .reduce((acc, row) => acc + row.durationMs + row.gapAfterMs, 0);
  const shiftEqualsInsertedTotal =
    insertedTotalMs === result.proofs.locality.postBoundaryShiftMs &&
    localityRows.every((row) =>
      row.postBoundary
        ? row.startMsDelta === result.proofs.locality.postBoundaryShiftMs
        : row.startMsDelta === 0,
    );
  const byteIdentityAllGreen = localityRows.every((row) => row.wavSha256Equal);

  // Grounding: retrieval + the F1 check verdict, with the retrieved claims'
  // statements for the panel.
  const claimById = new Map(baseline.graph.claims.map((claim) => [claim.id, claim]));
  const claims: SessionGroundingClaim[] = result.retrieval.retrievedClaimIds.map((claimId) => {
    const claim = claimById.get(claimId);
    return {
      claimId,
      statement: claim?.statement ?? '(claim id not in graph)',
      salience: claim?.salience ?? 0,
    };
  });

  const sessionMasterSha256 = createHash('sha256').update(result.session.wav).digest('hex');
  const speechProvider =
    result.responseCompile.artifact.providers.find((usage) => usage.stage === 'speech')
      ?.provider ?? 'deterministic-offline-tts';

  return {
    sessionId: stored.sessionId,
    overviewId: stored.overviewId,
    interventionId: forkId,
    interventionSeq: seq,
    afterTurnIndex: result.config.afterTurnIndex,
    listenerText: result.config.listenerText,
    listenerInputMode: SESSION_LISTENER_INPUT_MODE,
    semantics: SESSION_FORK_SEMANTICS,
    evidenceClass: 'REPRODUCED',
    timeline,
    insertedTurnIds: [...insertedIds],
    response: {
      planId: result.responsePlan.id,
      turnCount: result.responseCompile.timing.entries.length,
      realizedTexts: result.responseCompile.realized.map((turn) => turn.text),
      provider: speechProvider,
      sameMachineryNote: SAME_MACHINERY_NOTE,
    },
    sessionMaster: {
      artifactId: result.session.artifactId,
      audioUrl: `/audio/${result.session.artifactId}/master.wav`,
      sha256: sessionMasterSha256,
      sizeBytes: result.session.wav.byteLength,
      totalDurationMs: manifest.totalDurationMs,
      turnCount: manifest.entries.length,
      baselineTotalDurationMs: baseline.result.timing.totalDurationMs,
    },
    baselineMaster: {
      artifactId: baseline.response.artifactId,
      audioUrl: baseline.response.audioUrl,
      totalDurationMs: baseline.result.timing.totalDurationMs,
    },
    locality: {
      rows: localityRows,
      postBoundaryShiftMs: result.proofs.locality.postBoundaryShiftMs,
      insertedTotalMs,
      shiftEqualsInsertedTotal,
      originalOrderPreserved: result.proofs.order.originalOrderPreserved,
      byteIdentityAllGreen,
      passed: result.proofs.locality.passed,
      invariantLine: LOCALITY_INVARIANT_LINE,
    },
    grounding: {
      passed: result.grounding.passed,
      w1Valid: result.grounding.w1Valid,
      w2IssueCount: result.grounding.w2Issues.length,
      claimsResolve: result.grounding.claimsResolve,
      responseTurnId: result.grounding.responseTurnId,
      retrievedClaimIds: [...result.retrieval.retrievedClaimIds],
      matchedByContent: result.retrieval.matchedByContent,
      claims,
    },
    provenance: {
      seed: stored.seed,
      now: stored.now,
      mastering: stored.mastering,
      baselineArtifactId: baseline.response.artifactId,
      responsePlanId: result.responsePlan.id,
      responseArtifactId: result.responseCompile.artifact.id,
      sessionArtifactId: result.session.artifactId,
      sessionMasterSha256,
      sameMachineryNote: SAME_MACHINERY_NOTE,
      // WFLX-UI3 audit fill (display layer only): the GeneratedArtifact
      // sourceIds convention on the session lineage, + the response segment's
      // QA summary as carried on the session artifact sidecar (never hidden).
      sourceIds: [...result.session.artifact.sourceIds],
      responseQa: {
        status: result.session.artifact.qa?.status ?? 'not-evaluated',
        issueCount: result.session.artifact.qa?.issues.length ?? 0,
      },
      reproducible: result.session.artifact.generator.reproducible,
    },
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function requireSession(ctx: StudioContext, sessionId: string): StoredSession {
  const stored = ctx.sessions.get(sessionId);
  if (stored === undefined) {
    throw new StudioValidationError(
      'unknown-session',
      `no interactive session '${sessionId}' on this server instance — join first via POST /api/session (the registry is in-memory; a restart resets it)`,
      { sessionId },
    );
  }
  return stored;
}
