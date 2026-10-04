/**
 * WebFlix-Lab Operator Studio (WFLX-UI1) — the studio's own HTTP contract.
 *
 * Shared DTO vocabulary for the api/ handlers and the zero-build web client
 * (web/app.ts imports these as TYPE-ONLY imports; Bun's transpiler strips
 * them, so the browser bundle stays dependency-free). Domain types come from
 * the frozen W1 contracts via type-only imports — this file defines no
 * pipeline semantics of its own.
 *
 * Evidence law (AGENTS.md): every response this surface returns is
 * REPRODUCED-class lab implementation output. It never claims observation of
 * the Gemini Notebook product.
 */

import type { AudioOverviewMode, GeneratedArtifact, UtcTimestamp } from '../../../src/contracts';
import type { TimingManifest } from '../../../src/audio';

export const STUDIO_VERSION = 'wflx-studio@0.1.0';

/** Fixed port law: `bun run studio` always serves 4313. */
export const STUDIO_PORT = 4313;

/** Audio modes the Director already supports (no invented modes). */
export const STUDIO_AUDIO_MODES: readonly AudioOverviewMode[] = [
  'deep-dive',
  'brief',
  'critique',
  'debate',
];

/** Canonical duration per mode (the repo's canonical experiment arms). */
export const CANONICAL_MODE_DURATION_SECONDS: Readonly<Record<AudioOverviewMode, number>> = {
  'deep-dive': 300,
  brief: 120,
  critique: 300,
  debate: 300,
};

/** Duration bounds accepted by the compile route (Director supports any
 * positive target; the studio curates a sane operator range). */
export const DURATION_BOUNDS_SECONDS = { min: 60, max: 600 } as const;

// ---------------------------------------------------------------------------
// GET /api/sources
// ---------------------------------------------------------------------------

export interface SourceModeInfo {
  readonly mode: AudioOverviewMode;
  readonly canonicalDurationSeconds: number;
  readonly default: boolean;
}

export interface SourceDescriptor {
  readonly id: string;
  /** Repo-relative path label (provenance; never a secret). */
  readonly label: string;
  readonly title: string;
  readonly adapter: string;
  readonly extractor: string;
  readonly language: string;
  readonly wordCount: number;
  readonly blockCount: number;
  /** Fingerprint exactly as the repo computes it (src/source/normalize.ts). */
  readonly fingerprint: {
    readonly contentSha256: string;
    readonly rawSha256: string;
    readonly textLength: number;
  };
  readonly modes: readonly SourceModeInfo[];
  readonly durationBoundsSeconds: { readonly min: number; readonly max: number };
}

export interface SourcesResponse {
  readonly surface: string;
  readonly sources: readonly SourceDescriptor[];
}

// ---------------------------------------------------------------------------
// GET /api/health
// ---------------------------------------------------------------------------

export interface GatedProviderInfo {
  readonly id: string;
  readonly activation: string;
  /** 'off' | 'env-requested' — state only; never switchable from the UI. */
  readonly state: 'off' | 'env-requested';
}

export interface ProviderState {
  /** Active speech provider id (honest, from the compile path). */
  readonly active: string;
  readonly choice: 'offline';
  readonly note: string;
  readonly gated: readonly GatedProviderInfo[];
}

export interface HealthResponse {
  readonly ok: true;
  readonly version: string;
  readonly provider: ProviderState;
}

// ---------------------------------------------------------------------------
// POST /api/overview
// ---------------------------------------------------------------------------

export interface OverviewRequest {
  readonly sourceId: string;
  readonly mode?: AudioOverviewMode;
  readonly durationSeconds?: number;
}

/** Validated compile request (post-parse). */
export interface ValidOverviewRequest {
  readonly sourceId: string;
  readonly mode: AudioOverviewMode;
  readonly durationSeconds: number;
}

export interface PlanSummary {
  readonly planId: string;
  readonly mode: AudioOverviewMode;
  readonly language: string;
  readonly audience: string;
  readonly targetDurationSeconds: number;
  readonly planHash: string;
  readonly speakerCount: number;
  readonly turnCount: number;
  readonly beatCount: number;
  readonly coveredClaimCount: number;
  readonly omittedClaimCount: number;
  readonly objective: string;
}

export interface SpeakerInfo {
  readonly role: string;
  readonly name: string;
}

/** Realized turn joined with its timing entry — the player-facing view. */
export interface TranscriptRow {
  readonly turnId: string;
  readonly index: number;
  readonly speakerRole: string;
  readonly speakerName: string;
  readonly purpose: string;
  readonly text: string;
  readonly wordCount: number;
  readonly startMs: number;
  readonly endMs: number;
}

export interface OverviewResponse {
  readonly artifactId: string;
  readonly sourceId: string;
  readonly evidenceClass: 'REPRODUCED';
  readonly surfaceNote: string;
  /** Speech provider id used for this compile (reported honestly). */
  readonly provider: string;
  readonly providerChoice: 'offline';
  readonly mastering: string;
  readonly audioUrl: string;
  readonly plan: PlanSummary;
  readonly speakers: readonly SpeakerInfo[];
  readonly timing: TimingManifest;
  readonly transcript: readonly TranscriptRow[];
  /** The repo's artifact.json conventions (GeneratedArtifact sidecar). */
  readonly artifact: GeneratedArtifact;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export interface ApiErrorBody {
  readonly error: string;
  readonly message: string;
  readonly stage?: string;
}

// ---------------------------------------------------------------------------
// Interactive Audio session (WFLX-UI2) — POST /api/session,
// POST /api/session/:id/intervene, GET /api/session/:id
// ---------------------------------------------------------------------------

/**
 * The lab's fork-and-compare session semantics, as the machinery defines
 * them (each intervene() re-forks from the stored baseline). Displayed
 * verbatim on the UI surface — the product's cumulative multi-turn chat is
 * NOT imitated.
 */
export const SESSION_FORK_SEMANTICS =
  'each question re-forks the session from the baseline (lab semantics)' as const;

/**
 * The documented text-scripted stand-in class (LAB-13 / EXP-L-18): voice
 * capture is UNRESOLVED; the UI carries this exact label and offers no
 * microphone anything.
 */
export const SESSION_LISTENER_INPUT_MODE =
  'typed listener question — voice capture UNRESOLVED (text stand-in)' as const;

/** In-memory session registry note (restart resets; documented). */
export const SESSION_PERSISTENCE_NOTE =
  'in-memory session registry on this server instance only — restart resets sessions and compiled overviews' as const;

/** POST /api/session request body. */
export interface SessionEstablishRequest {
  readonly overviewId: string;
}

/** POST /api/session response (session established over the stored baseline). */
export interface SessionEstablishResponse {
  readonly sessionId: string;
  /** The compiled baseline's artifact id (the studio overview store key). */
  readonly overviewId: string;
  /** Baseline turn count (timing manifest entries). */
  readonly turnCount: number;
  /** Valid interior turn boundaries: indexes 0..turnCount-2. */
  readonly validBoundaries: readonly number[];
  /** Times this baseline has been joined (idempotent re-join increments). */
  readonly joins: number;
  readonly semantics: string;
  readonly listenerInputMode: string;
  readonly persistenceNote: string;
  readonly evidenceClass: 'REPRODUCED';
}

/** POST /api/session/:id/intervene request body. */
export interface SessionInterveneRequest {
  readonly afterTurnIndex: number;
  readonly listenerText: string;
}

/**
 * One turn in the session timeline: the baseline sequence with the response
 * turns inserted at the boundary (original order preserved). Inserted rows
 * carry `inserted: true` and a null baselineIndex.
 */
export interface SessionTurnRow {
  readonly turnId: string;
  readonly sessionIndex: number;
  /** Baseline turn index for original turns; null for inserted response turns. */
  readonly baselineIndex: number | null;
  readonly speakerRole: string;
  readonly speakerName: string;
  readonly purpose: string;
  readonly text: string;
  readonly wordCount: number;
  readonly startMs: number;
  readonly endMs: number;
  readonly durationMs: number;
  readonly gapAfterMs: number;
  readonly inserted: boolean;
}

/** Locality proof row: one original turn, baseline vs session. */
export interface SessionLocalityRow {
  readonly turnId: string;
  readonly baselineIndex: number;
  /** Byte-identity verdict: baseline turn WAV bytes reused in the session master. */
  readonly wavSha256Equal: boolean;
  readonly actualSecondsEqual: boolean;
  readonly gapAfterMsEqual: boolean;
  readonly baselineStartMs: number;
  readonly sessionStartMs: number;
  /** The post-boundary shift (0 pre-boundary; the inserted response total after). */
  readonly startMsDelta: number;
  readonly postBoundary: boolean;
}

/** A retrieved claim grounding the response (graph statement, for the panel). */
export interface SessionGroundingClaim {
  readonly claimId: string;
  readonly statement: string;
  readonly salience: number;
}

/** POST /api/session/:id/intervene response (serialized InteractiveSessionResult). */
export interface SessionInterveneResponse {
  readonly sessionId: string;
  readonly overviewId: string;
  readonly interventionId: string;
  readonly interventionSeq: number;
  readonly afterTurnIndex: number;
  readonly listenerText: string;
  readonly listenerInputMode: string;
  readonly semantics: string;
  readonly evidenceClass: 'REPRODUCED';
  /** The full session sequence: original turns + inserted response turns. */
  readonly timeline: readonly SessionTurnRow[];
  readonly insertedTurnIds: readonly string[];
  /** The response block (compiled through the same machinery). */
  readonly response: {
    readonly planId: string;
    readonly turnCount: number;
    readonly realizedTexts: readonly string[];
    readonly provider: string;
    readonly sameMachineryNote: string;
  };
  /** The session master (its own artifact id — never overwrites the baseline). */
  readonly sessionMaster: {
    readonly artifactId: string;
    readonly audioUrl: string;
    readonly sha256: string;
    readonly sizeBytes: number;
    readonly totalDurationMs: number;
    readonly turnCount: number;
    readonly baselineTotalDurationMs: number;
  };
  /** The baseline master stays available for comparison. */
  readonly baselineMaster: {
    readonly artifactId: string;
    readonly audioUrl: string;
    readonly totalDurationMs: number;
  };
  /** Locality proof (C-5): per-original-turn byte identity + the shift invariant. */
  readonly locality: {
    readonly rows: readonly SessionLocalityRow[];
    readonly postBoundaryShiftMs: number;
    /** Inserted response total recomputed from the session timeline (turns + gaps). */
    readonly insertedTotalMs: number;
    /** Invariant: post-boundary shift == inserted response total (and pre-boundary shift 0). */
    readonly shiftEqualsInsertedTotal: boolean;
    readonly originalOrderPreserved: boolean;
    readonly byteIdentityAllGreen: boolean;
    readonly passed: boolean;
    readonly invariantLine: string;
  };
  /** Grounding summary (F1): retrieval + the W1/W2 check verdict. */
  readonly grounding: {
    readonly passed: boolean;
    readonly w1Valid: boolean;
    readonly w2IssueCount: number;
    readonly claimsResolve: boolean;
    readonly responseTurnId: string;
    readonly retrievedClaimIds: readonly string[];
    readonly matchedByContent: boolean;
    readonly claims: readonly SessionGroundingClaim[];
  };
  /** Retrieval + response provenance. */
  readonly provenance: {
    readonly seed: string;
    readonly now: string;
    readonly mastering: string;
    readonly baselineArtifactId: string;
    readonly responsePlanId: string;
    readonly responseArtifactId: string;
    readonly sessionArtifactId: string;
    readonly sessionMasterSha256: string;
    readonly sameMachineryNote: string;
    /**
     * WFLX-UI3 audit fill (provenance completeness): the session lineage's
     * source artifact ids (GeneratedArtifact.sourceIds convention — the
     * session artifact carries the baseline's sourceIds).
     */
    readonly sourceIds: readonly string[];
    /**
     * WFLX-UI3 audit fill: the response segment's QA summary as carried on
     * the session artifact sidecar (status + issue count; honest reporting).
     */
    readonly responseQa: {
      readonly status: string;
      readonly issueCount: number;
    };
    /**
     * WFLX-UI3 audit fill: the session artifact's generator reproducible
     * flag (byte-identical re-fork at fixed seed/now/intervention).
     */
    readonly reproducible: boolean;
  };
}

/** Fork-history entry in GET /api/session/:id. */
export interface SessionInterventionSummary {
  readonly interventionId: string;
  readonly interventionSeq: number;
  readonly afterTurnIndex: number;
  readonly listenerText: string;
  readonly insertedTurnIds: readonly string[];
  readonly sessionArtifactId: string;
  readonly sessionMasterSha256: string;
  readonly groundingPassed: boolean;
  readonly localityPassed: boolean;
  readonly originalOrderPreserved: boolean;
}

/** GET /api/session/:id response (current session state). */
export interface SessionStateResponse {
  readonly sessionId: string;
  readonly overviewId: string;
  readonly joins: number;
  readonly turnCount: number;
  readonly validBoundaries: readonly number[];
  readonly semantics: string;
  readonly listenerInputMode: string;
  readonly persistenceNote: string;
  readonly evidenceClass: 'REPRODUCED';
  readonly interventions: readonly SessionInterventionSummary[];
}

export type { AudioOverviewMode, GeneratedArtifact, TimingManifest, UtcTimestamp };
