# Video Overview (WFLX-W3, Phase 2B)

Compile a video-modality `OverviewPlan` into a source-grounded narrated visual
explainer, reproducing the golden reference's visual grammar.

```text
OverviewPlan (W1 contract, scene-authoritative)
      |
      v
VideoScene[] realized          <-- src/video/storyboard (validate + enrich + ground)
      |
      v
SceneGraph (W3 IR)             <-- render specs + narration segments
      |
      v
Deterministic SVG frames       <-- src/video/render (byte-identical)
      |          |
      |          +--> src/providers/visual (illustration port; offline ink adapter)
      |          +--> src/providers/video   (motion port; parametric plans)
      v
Timeline                       <-- src/compositor/timeline (shared pure math)
      |
      +--> Remotion composition    (src/compositor/remotion; primary backend)
      +--> Deterministic fallback  (src/compositor/fallback; SVG frames + ffmpeg/librsvg)
      |
      v
MP4 + narration (placeholder) + QA + GeneratedArtifact sidecar
```

## Module map

| Path | Role |
| --- | --- |
| `style-bible.ts` | StyleBible schema + canonical `style-bible--reference-ink` distilled from the committed annotation |
| `storyboard/types.ts` | SceneGraph working IR (NOT a shared contract) |
| `storyboard/compiler.ts` | `compileVideoScenes`: validate + enrich + ground plan scenes |
| `render/svg.ts` | Deterministic SVG primitives (escaping, measure, geometry) |
| `render/layouts.ts` | Per-visual-type frame layouts (all 13 contract types) |
| `render/renderer.ts` | `renderStoryboardSvg`: byte-identical frames + grounding traces |
| `narration` (in `index.ts`) | Narration segment realization + placeholder audio (compositor) |
| `qa/` | Deterministic metrics: alignment, style consistency, grounding, determinism, structure, coverage |
| `artifacts.ts` | GeneratedArtifact sidecar emission (W1 contract) |
| `rng.ts` | Seeded PRNG utilities (per-choice keys, W2 convention) |

## Binding rules

- The plan's `videoScenes` are PLAN-AUTHORITATIVE: this surface never adds,
  drops, reorders or re-typed scenes (mirrors W2 DESIGN.md §16.2).
- Exact labels, numbers and relationships render as crisp structured SVG —
  never as text inside generated illustration (annotation rule 1).
- Illustration/metaphor render generatively via the provider port; the
  offline deterministic ink adapter is the canonical no-network path.
- Every stochastic choice keys on (seed, scene-LOCAL content hash, mode,
  sceneId, choice) — the C-5 v2 re-keying (src/contracts/unit-content-hash.ts);
  planHash stays in identification surfaces only (storyboard meta, artifact
  ids, QA reports).
- Provider-specific shapes stay inside adapters; no credentials anywhere.
- Placeholder narration and ink illustrations are NOT product parity
  evidence (AGENTS.md).

## Entry points

```ts
import { compileVideoOverview, compileVideoScenes } from '../video';

const result = await compileVideoOverview(plan, graph, {
  output: 'artifacts/video/overview.mp4',
  now: '2026-09-28T00:00:00Z', // REQUIRED — no hidden clock
});
```

`bun run video:benchmark` regenerates the committed benchmark artifacts
deterministically (see `artifacts/video/README.md`).

Design detail and evidence reasoning: `src/video/DESIGN.md`.
