# Video Surface Design (WFLX-W3, Phase 2B)

Status: IMPLEMENTED. This document records the design decisions behind
`src/video`, `src/providers/visual`, `src/providers/video` and
`src/compositor`, with their evidence grounding.

Evidence labels per AGENTS.md: OBSERVED / DOCUMENTED / HYPOTHESIS /
REPRODUCED / UNRESOLVED. Statements about the golden reference video are
OBSERVED (verified in this lab from the committed binary; instrument
protocol in `reference/annotations/reference-video-scenes.md`). Statements
about this implementation are REPRODUCED by `tests/video/`.

## 1. Scope and ownership

Worker 3 owns the video surface of the Overview Compiler (work order
Phase 2B): reference annotation, StyleBible, VideoScene compiler,
deterministic SVG/diagram renderer, illustration adapter, optional
motion/video adapter, composition, and video QA. The shared contracts
(`src/contracts/`) are W1-frozen and are never edited here; contract change
requests surface as HANDOFF entries.

## 2. The annotation gate (what the reference actually does)

Before any implementation, the committed served-variant binary was verified
(sha256 `f1241c21…31768b`; ffprobe 415.613968 s, 1280x720, 30 fps, AAC mono
44.1 kHz — OBSERVED, matching the artifact manifest) and annotated over its
FULL duration: 49 segments, no gaps, no overlaps. Key OBSERVED findings that
shape this design:

1. **Two text classes.** Crisp designed/structured text (labels, titles,
   numbered steps) is visually distinct from stylized pseudo-text inside
   generated illustration. → The contract's `SceneTextItem.exact` maps to
   the first class; the renderer places exact texts verbatim as vector
   text, and the illustration adapter is forbidden from emitting text.
2. **Crossfade-dominant, narration-led cuts.** 25 crossfades vs 18 hard
   cuts; 75% of cuts land within 0.25 s of a narration pause (median
   0.128 s). → Boundary-centered crossfades in the timeline; narration
   segments are scene-aligned by construction and the QA alignment metric
   proves it stays 0 (mutations fire).
3. **Static-dominant motion.** 37/49 segments static; motion spent
   deliberately. → `motion: 'static'` is the default; the deterministic
   motion planner bounds pan to ±4% of canvas and zoom to +3–8%.
4. **Graphite ground, cyan/teal emphasis, crimson warnings.** Palette
   roles with evidence per hex (`src/video/style-bible.ts`); QA enforces
   frame colors ⊆ palette.
5. **Pacing follows narration** (median ≈ 7.5 s, mean 8.48 s), not a fixed
   cadence. → Scene durations come from the plan (Director-owned).

## 3. Plan authority (the W2 precedent, applied)

The Director already emits plan-level `videoScenes` (W1). Repeating W2's
§16.2 repositioning: the scene skeleton (set, order, types, classes,
durations, claim grounding) is PLAN-AUTHORITATIVE. The W3 compiler
validates it (hard failures throw `VideoCompilerError`; e.g. unknown
claim/beat, exact texts missing on deterministic scenes — atlas rule 2,
duration sums beyond ±15%), enriches it (StyleBible binding, narration
refs, derived visual briefs — deterministic and seeded), resolves grounding
(claims → entities → relationships from the SemanticGraph) and realizes
narration segments. It never adds, drops or reorders scenes.

Coverage through the video surface follows the H-4 boundary ruling
(docs/handoff/handoff-adjudications-001.md): beat-only coverage is legal at
the plan layer; claims covered by the plan but visualized by no scene
surface as `coverage-gap` warnings (video-surface interpretation).

Mode semantics: Explainer predicates are DOCUMENTED (narrated slides
combining generated visuals with diagrams/quotes/numbers); Short's duration
bound is HYPOTHESIS-labeled; Cinematic semantics are UNRESOLVED in this lab
(info-severity note; rendering proceeds with Explainer grammar — the first
visual target per docs/notebooklm-overviews-research.md).

## 4. Determinism architecture

- **Renderer** (the pinned layer): identical inputs → byte-identical SVG.
  Pure functions, stable element order, fixed 2-decimal formatting, seeded
  per-choice PRNG keys `(seed, scene-local content hash, mode, sceneId,
  choice)` (C-5 v2 re-keying; planHash stays in identification surfaces).
  Proven by
  the hash pair in `determinism.json` and by `tests/video`.
- **Illustration provider**: the offline deterministic ink adapter is a
  seeded procedural composer (paper grain, construction grid, controller
  knot, hex satellites, dashed loop, isometric slabs — the annotation's
  recurring motifs). The optional image-model adapter returns raster data
  and is honestly flagged non-deterministic when selected.
- **Composition**: both backends consume the SAME pure timeline math
  (`src/compositor/timeline.ts`), so Remotion and the fallback composite
  identically by construction. The MP4 encode depends on the h264 build;
  byte-stability across environments is NOT claimed — the SVG layer is the
  reproducibility artifact (recorded in provenance notes).
- **`now` is required** for the sidecar timestamp (no hidden clock),
  mirroring W2.

## 5. Composition backends

- **Remotion (primary).** The composition is authored with
  `React.createElement` (no JSX) so the TL-owned root tsconfig needs no
  change. `calculateMetadata` derives duration/fps from the inputProps
  timeline. The render driver discovers a headless browser (explicit
  `WFLX_REMOTION_BROWSER` → Playwright `chrome-headless-shell` → Chromium)
  and never downloads one. Remotion + React are devDependencies: rendering
  is a dev-time lab operation; module code lazy-imports them.
- **Deterministic fallback.** When no browser exists, the offline
  compositor writes every output frame as SVG (the same shared math) and
  assembles with SYSTEM ffmpeg when it carries the librsvg decoder
  (Debian builds do; capability-detected). Without ffmpeg/librsvg it still
  emits the frame sequence + manifest and names the missing capability.

## 6. Providers

- `src/providers/visual/port.ts` — provider-neutral IllustrationProvider
  (SVG fragment out, no text, StyleBible palette projection in).
  `deterministic-ink.ts` is the canonical offline adapter;
  `image-model.ts` is an optional OpenAI-compatible adapter, env-gated
  (`WFLX_VISUAL_ILLUSTRATION_PROVIDER=image-model` + runtime-injected
  endpoint/key; never committed; throws rather than degrades silently).
- `src/providers/video/port.ts` — optional motion stage. The deterministic
  adapter plans parametric camera moves (pure functions of motion intent +
  seed). `remote-motion.ts` shells a video-generation backend (env-gated,
  UNRESOLVED vs the reference's true pipeline — no claim about Google
  internals). The annotation shows motion is deliberate and rare, which
  parametric motion already reproduces.

## 7. Video QA (deterministic metrics only)

| # | Metric | Fires on |
|---|---|---|
| 1 | `scene_narration_alignment` | segment starts drifting from scene boundaries (warn > 0.5 s, error > 1.5 s; observed reference median 0.128 s) |
| 2 | `style_consistency` | off-palette colors, off-style fonts, wrong canvas |
| 3 | `visual_grounding` | missing exact texts, weak entity traces, ungrounded scenes |
| 4 | `determinism` | render hash pair mismatch (blocker) |
| 5 | `scene_structure` | timeline gaps, zero spans, duration drift |
| 6 | `coverage_surface` | plan-covered claims no scene visualizes |

Every issue names the smallest regenerable unit (scene id) and maps onto
the contract `QaSummary` riding on `GeneratedArtifact.qa`.

## 8. What is deliberately NOT claimed

- The offline ink illustrations and placeholder narration are lab
  instruments, not product parity evidence.
- MP4 byte-determinism across encoder builds is not claimed.
- Cinematic mode semantics, and the reference's true illustration
  generation pipeline, are UNRESOLVED.
- Narration TTS is realized as placeholder audio in this surface; routing
  real narration through the W2 speech surface is a Phase 3 integration
  task (TL-owned), recorded as a HANDOFF in the Phase 2B report.

## 9. Open handoffs

See the Phase 2B completion report for the live HANDOFF list, including:
VideoScene has no field for per-scene narration text (W3 keeps narration in
its own IR keyed by `narrationRef`), and `SceneMotion`/`SceneTransition`
have no parameters (durations live in the StyleBible instead).
