# Shared Contracts (frozen)

Worker 1 froze these contracts in the WFLX-W1 contract-freeze PR. The frozen
list from the TL #2 handoff:

- SourceArtifact
- ClaimRecord
- EntityRecord
- TopicRecord
- RelationshipRecord
- OverviewPlan
- AudioTurn
- VideoScene
- GeneratedArtifact
- ExperimentRecord

plus one derived container that binds the four graph records to their
sources (declared openly at freeze time, not a silent addition):

- SemanticGraph

Do not duplicate or redefine these contracts in worker-specific directories.
Shared-contract changes after the freeze require a HANDOFF note in the
changing worker's report (AGENTS.md drift controls); version the bundle via
`CONTRACTS_VERSION` in `src/contracts/primitives.ts`.

## Where things live

- `src/contracts/*.ts` — zod schemas + inferred TypeScript types (one file
  per contract) + `validation.ts` (deep, cross-record validators).
- `src/contracts/schemas/*.schema.json` — emitted, self-contained
  draft-2020-12 JSON Schemas for cross-worker interop
  (`bun run contracts:emit`; tests enforce byte-identical emission).
- `fixtures/contracts/` — canonical fixtures (regenerate deterministically
  with `bun run fixtures:gen`; tests enforce byte-identical regeneration):
  hand-built ground truth (reference-messy-note source/graph, deep-dive and
  explainer plans, minimal pair, examples) PLUS Director-emitted canonical
  per-mode plans (`plan-audio-brief-2min` / `plan-audio-critique-5min` /
  `plan-audio-debate-5min`, compiled by `compileOverviewPlan` with fixed
  seeds — Phase 3 H-2; pinned fingerprints in tests/contracts/fixtures.test.ts
  and EV-005).
- `tests/contracts/` — red/green contract tests.

## Design decisions (justified)

1. **zod v4 as the single source of truth.** Types are `z.infer`, runtime
   guards are the schemas themselves, and JSON Schemas are emitted from the
   same definitions. This avoids hand-syncing three representations, which
   is the main drift risk of a frozen contract set. zod is the only runtime
   dependency of the lab.
2. **Three validation layers, each doing what it can:**
   - zod field rules (shape, enums, patterns, ranges) — expressible in JSON
     Schema;
   - zod `.check()` cross-field rules (modality/mode correlation,
     `end > start`, heading levels, graph referential integrity, media spec
     presence) — NOT expressible in JSON Schema; guard-only;
   - `validation.ts` deep validators (quote/offset slice equality against
     real source text, fingerprint correctness, coverage accounting, beat
     weight and duration budgets) — need multiple records.
   The mutant corpus (`fixtures/contracts/mutants/`) proves each layer
   catches what the others cannot.
3. **Offsets are UTF-16 code units into the NFC-normalized source text**
   (JavaScript string indices). `quote === text.slice(start, end)` is the
   grounding invariant.
4. **Block spans include markdown markers** (`# `, `- `) so the slice
   invariant stays exact; consumers strip markers for semantic content.
5. **`recordType` + `contractVersion` on every record** for JSON interop
   and version discipline (guard accepts the frozen major only).
6. **Evidence-label discipline is encouraged, not hard-enforced.**
   `hasEvidenceLabel()` is exported for pipelines that want strictness;
   the guard does not reject unlabelled observations (AGENTS.md labels are
   for statements, and the frozen shape should not force them).
7. **ExperimentRecord mirrors docs/experiments/protocol.md** (the YAML
   record template) plus `evidenceKind` from the docs/evidence registry
   convention. Field naming is camelCase; the legacy registry JSONL
   (TL-owned) keeps its snake_case shape.

## Mode vocabularies

`OverviewPlan.mode` values are the DOCUMENTED Gemini Notebook formats
(audio: Deep Dive, Brief, Critique, Debate; video: Explainer, Short,
Cinematic) per docs/notebooklm-overviews-research.md. The modality/mode
correlation is enforced by the TypeScript guard.

## Coverage boundary semantics (adjudication H-4, 2026-09-27)

`CoverageEntry.unitIds` may cite a beat that has no grounding turn in the
plan's `audioTurns` — **beat-only coverage is legal at the plan layer**. A
claim covered only by a beat is expressible in a valid plan (e.g.
video-pending or agenda-only material), and W1's plan validation accepts it
by design.

The **audio surface** — which speaks through turns — must treat beat-only
coverage as a coverage gap: the audio QA `coverage-gap` error at the
audio/plan boundary is correct behavior, not a defect. Surfaces interpret
coverage through their own units; the plan layer does not force every claim
into every modality.

This boundary is documented here (doc-only ruling, no code change to W1
validation). It is one of the consolidated v2 contract-change candidates
(H-4 in docs/handoff/handoff-adjudications-001.md) to be revisited as a
wave after W3 lands, alongside per-claim evidence enforcement (H-5, if the
cross-modal QA fallback rate proves material) and stance/contestedness
signals (H-1).

> **C-3 closed at CONTRACTS_VERSION 2.0.0** (v2 contract wave, ruling
> 2026-09-29): this beat-vs-turn coverage boundary ruling is CLOSED as
> documented — it rides the v2 version bump as this version-stamped note
> only, with no schema change and no code change to W1 validation. The
> remaining v2 candidates (H-5, H-1) stay deferred with their recorded
> reasons in docs/handoff/v2-contract-wave-draft.md.

## Fixture-only success is not product parity

Contract and fixture tests establish conformance to the frozen IR only.
Product-parity evidence follows the experiment protocol
(docs/experiments/protocol.md) and the acceptance rules in AGENTS.md.
