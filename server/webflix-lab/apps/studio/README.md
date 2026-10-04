# Operator Studio (apps/studio)

The lab's browser surface over the frozen pipeline. **WFLX-UI1** delivered
the shell: compile an **Audio Overview through the REAL WebFlix-Lab
pipeline** and play it in the browser. **WFLX-UI2** layered **Interactive
Audio** on top (surface D): join a session, ask a typed listener question at
a turn boundary, hear/see the source-grounded response inserted into the
overview — with the locality + grounding proofs rendered on screen.
**WFLX-UI3** closed the stage: provenance completeness (the audit fills this
README records), journey documentation, and the parity-close amendment
(docs/promotion/parity-close-decision.md, studio-stage section).

Everything this surface produces is **REPRODUCED-class lab evidence**
(AGENTS.md) — compiled by the offline deterministic speech provider
(placeholder audio). It is **not** the Gemini Notebook product, and it never
claims product parity. The operator studio observes nothing about the
product; it is a research implementation that drives the lab's own frozen
machinery.

## Run it

```bash
bun run studio          # == bun run apps/studio/server.ts  ->  http://localhost:4313
```

**Port law: 4313, fixed.** The server always serves `http://localhost:4313`
(no `PORT` env override). No build step, no bundler, no new npm dependency.
The client is plain HTML + CSS + vanilla TypeScript; `/app.js` is `web/app.ts`
served type-stripped at request time (Bun's transpiler).

Gates (run from the repo root):

```bash
bun run typecheck       # tsc --noEmit — typechecks every studio file, client included
bun run lint            # eslint — apps/ covered under the repo's strict rules
bun test apps/studio/test/   # the studio battery (part of the root `bun test` run)
```

The client declares its narrow DOM surface locally because the root tsc
program deliberately carries no `DOM` lib — adding one would change
`Response`/`BodyInit` resolution for frozen test files.

## The operator console gateway (XTransformPort=4313)

The station environment exposes ONE external port; its preview gateway
routes a request to the studio's fixed port **only when the URL carries the
`XTransformPort=4313` query (the routing key)**. Every fetch and audio URL
the studio client issues therefore appends that query in relative form
(`api/overview?XTransformPort=4313`, `/audio/:id/master.wav?XTransformPort=4313`)
— see `withGatewayQuery()` in `web/app.ts`. Direct `localhost:4313` access
works identically: the studio server ignores unknown query parameters, so
the same URLs serve both paths.

## Surface

| Route | What it does |
|---|---|
| `GET /` | the studio client (dark lab theme) |
| `GET /api/health` | `{ok, version, provider}` — active provider id + env-gated live providers' STATE only |
| `GET /api/sources` | checked-in fixtures usable as real pipeline sources, with repo-computed sha256 fingerprints |
| `POST /api/overview` | `{sourceId, mode?, durationSeconds?}` → compiles through the real pipeline; returns plan metadata, timing manifest, transcript, the full GeneratedArtifact sidecar, and `audioUrl` |
| `POST /api/session` | `{overviewId}` → joins an `InteractiveAudioSession` over the stored baseline; returns `{sessionId, overviewId, turnCount, validBoundaries}` (interior turn indexes) |
| `POST /api/session/:id/intervene` | `{afterTurnIndex, listenerText}` → `session.intervene()` (the real machinery); returns the session timeline with inserted response turns, the session master (own artifact id), locality proof rows + the shift invariant, the grounding summary, and retrieval/response provenance (seed, now, source ids, artifact ids, session-master sha256, response QA) |
| `GET /api/session/:id` | current session state: baseline id, joins, fork history |
| `GET /audio/:id/master.wav` | compiled master WAV — baseline overviews AND session masters (in-memory stores), HTTP Range supported |

Modes are exactly what the Director already supports (audio `deep-dive`
default, `brief`, `critique`, `debate`, canonical durations); durations are
curated within `[60, 600]` s. No invented modes. Language/audience are
pinned to the canonical `en` / `technical`.

## The operator journey (verified in-browser)

The station record (TL #2, agent-browser through the console gateway;
docs/work-items/roadmap-status.md, 2026-10-04 studio-stage entries — and
re-verified at the WFLX-UI3 station review):

1. **Source** — the landing lists the checked-in fixtures (the canonical
   `reference-messy-note-redacted.md`) with the repo-computed fingerprint
   (`sha256` content hash, full `contentSha256`/`rawSha256` in the tooltip),
   adapter id, word/block counts. The surface is labeled as the WebFlix-Lab
   research implementation — not the Gemini Notebook product.
2. **Compile** — pick a mode (`deep-dive` default) and duration, press
   **Compile Overview**. The real chain runs per request: source adapter →
   understanding → Director → plan → `compileAudioOverview` (no pre-baked
   plan JSON, no fixture shortcut). Loading state while it runs; typed
   errors on failure. Verified: Deep-Dive 300 s → 24 turns, 307.6 s
   actual (WFLX-UI3 station re-verification on the current main; the
   roadmap station records carry the same journey).
3. **Player + transcript + provenance** — the master WAV streams through
   the player (play/pause, seek, progress bar); the transcript timeline
   highlights the current turn from the timing manifest (click a turn to
   seek); the metadata panel shows the Director's plan (plan id + hash,
   mode, duration, speakers, beats, claim coverage); the provenance panel
   renders the repo's `GeneratedArtifact` conventions — artifact id,
   evidence class, **source ids**, media sha256 + size + format, speech
   provider, mastering, generator + seed, reproducible flag, honest QA
   status, per-stage providers, notes.
4. **Join Interactive Session** — the entry card appears after a successful
   compile and states the semantics up front: *each question re-forks the
   session from the baseline (lab semantics)*. Verified: session
   `ix-session-1`, 24 turns, 23 valid boundaries.
5. **Pick a boundary marker** — the transcript gains `⑂` markers at every
   VALID interior boundary (`0..turns-2`, exactly what the machinery
   accepts; the last turn is never a boundary). Click a marker to arm it.
   Verified: boundary 4.
6. **Typed ask** — the ask box is a text input labeled exactly *“typed
   listener question — voice capture UNRESOLVED (text stand-in)”* (voice
   capture is UNRESOLVED; no microphone is offered or faked — LAB-13 /
   EXP-L-18). The two EXP-L-03 scripted questions are offered as one-click
   chips, labeled *scripted — not AI-suggested*. Verified ask: *"Can you
   say more about the open-source media projects and local model
   runtimes?"*
7. **Inserted turns + locality table + grounding panel + session master** —
   the timeline re-renders with the response turns (ack + grounded answer)
   INSERTED and highlighted at the boundary; the player loads the SESSION
   MASTER (its own artifact id — the baseline master stays one click away
   for comparison); the **locality table** renders per original turn:
   byte-identity verdict (all green = original WAV bytes reused), baseline
   → session startMs, the shift column, and the invariant line
   *post-boundary shift == inserted response total*; the **grounding
   panel** lists the retrieved claims (ids + statements + salience), the
   matched-by-content verdict, and the F1 check; the **response provenance**
   panel carries seed, now, source ids, response plan/artifact ids, session
   artifact id + master sha256, response speech provider, response QA, and
   the same-machinery note. Verified: **24/24 original turns byte-identical,
   pre-boundary +0 ms, post-boundary uniformly +21,173 ms, F1 PASS**
   (claim-b13 + claim-b14 retrieved by content; W1 valid / W2 zero issues /
   claims resolve), session master **328.76 s = 307.59 + 21.17 exact**.
8. **Repeat (fork history)** — every intervention is listed (each an
   independent fork from the baseline; nothing is cumulative). Click a
   history entry to re-load its timeline + proofs.

## Semantics (binding, as the machinery defines them)

- Each `intervene()` run **forks from the stored baseline** — the lab's
  fork-and-compare semantics. The product's cumulative multi-turn chat is
  NOT imitated, and the UI labels that honestly on the surface. Re-joining
  the same baseline reuses the session (join counter increments, fork
  history preserved).
- `afterTurnIndex` must be an **interior boundary** (`0..turns-2`) — only
  valid boundaries are surfaced.
- Listener input is **TYPED** — the documented text-scripted stand-in class;
  voice capture is UNRESOLVED and the UI carries that exact label.

Session behavior guarantees (handoff §7) are what the panels render —
original-turn byte identity across the boundary, order preserved,
translation-only shift, C-5 locality, same-machinery response — and the
router-level test battery (`apps/studio/test/session.test.ts`) asserts them
END-TO-END, including determinism (double-intervene → identical
session-master sha256) and the WFLX-UI3 provenance-completeness fills.

**Session registry law:** sessions, compiled overviews, and session masters
live in per-process in-memory Maps. A server restart resets everything —
accepted and labeled on the surface (`in-memory — restart resets`).

## Determinism spine

The studio pins fixed constants (`STUDIO_DIRECTOR_SEED`,
`STUDIO_AUDIO_SEED`, `STUDIO_NOW = 2026-10-04T00:00:00Z`), the **offline
deterministic speech provider**, and the **pure-TS mastering backend**. Two
independent server boots fed identical compile requests produce
**byte-identical master WAVs** — asserted in
`apps/studio/test/determinism.test.ts` (the test boots two port-0 instances
of the same server module; the fixed 4313 port law applies to the dev
command).

Compiled media lives in memory only. The studio NEVER writes `artifacts/`,
never touches `docs/experiments/records/**`, `registry.json`, or any
committed fingerprint — compiled media is fingerprinted (sha256 in the
served sidecar) but never committed.

## Provenance completeness (WFLX-UI3 audit)

The three surfaces are audited field-by-field against the repo's
`GeneratedArtifact` / artifact.json conventions — record at
`docs/work-items/37-WFLX-UI3-STATION-INTEGRATION.md` (audit section):
**27 PASS / 5 GAP → fixed in the display layer / 7 N/A** (the field does
not exist at that stage) across 39 audited cells. The five fills: overview
`sourceIds` (render), session lineage `sourceIds`, response speech
provider, response-segment QA, and the session `reproducible` flag
(serialize + render) — zero machinery changes, zero frozen-tree edits, no
open gaps, no HANDOFF-required findings.

## Layout

```
apps/studio/
  server.ts        Bun.serve entry (port 4313) + createStudioServer() factory
  pipeline.ts      THE wiring point to the real pipeline (imports src/... only)
  sessions.ts      THE interactive session boundary: registry + InteractiveAudioSession driving
  api/             thin request handlers + the studio HTTP contract (types.ts)
  web/             zero-build static client (index.html, app.ts, styles.css)
  test/            bun test battery (boot, compile, manifest/URL, sessions, determinism)
```

`pipeline.ts` is orchestration only: it calls `MarkdownNoteAdapter` →
`DeterministicExtractor` → `compileOverviewPlan` → `compileAudioOverview`
and projects the result into the studio DTO. `sessions.ts` constructs
`InteractiveAudioSession` over the stored baseline and serializes
`InteractiveSessionResult` — it never re-implements retrieval, plan
construction, compilation, splicing, or proof evaluation. Zero domain
duplication, zero frozen-tree edits.

## Tests

```bash
bun test apps/studio/test/
```

28 tests (19 W1 shell + 8 W2 session + 1 W3 provenance-completeness
regression). Covers: health/provider-state honesty, source enumeration
(fingerprint parity with the checked-in
`reference-messy-note.source-artifact.json`), the compile-route integration
against the real pipeline (Director-derived plan id proves no fixture
shortcut), manifest/URL contracts, WAV sidecar-hash equality, typed 4xx
error bodies, the interactive session routes (establish/valid boundaries,
intervene asserting the §7 guarantees end-to-end, session-master serving,
double-intervene determinism, fork history, the provenance-completeness
fills, typed error paths), static client serving, and the cross-boot
byte-identity proof.

## Honest boundaries (never implied otherwise)

- Microphone / voice capture is **UNRESOLVED**. The interactive ask box is
  the documented TYPED text-scripted stand-in (labeled verbatim on the
  surface); this studio offers no microphone, no ASR, and no voice input of
  any kind.
- Interactive sessions use the lab's **fork semantics** (each question
  re-forks from the stored baseline — fork-and-compare). The product's
  cumulative multi-turn chat is NOT imitated — labeled on the surface.
- Speech is the **offline deterministic placeholder provider**, pinned; the
  audio is NOT product-parity evidence. Live providers (Gemini
  multi-speaker TTS, ZAI live TTS) stay env-gated OFF; the studio pins
  offline and only REPORTS their state — they are never switchable from the
  UI.
- The session registry + all compiled media are **in-memory only**; a
  server restart resets them.
- Compiled media is **fingerprinted, never committed** (sha256 in the
  served sidecar; `artifacts/` is never written).
- The operator studio observes nothing about the Gemini product; it is a
  REPRODUCED-class research implementation.
