# Audio Overview

Compile OverviewPlan into a grounded multi-speaker Audio Overview.

Required stages (all implemented as of W2 Stage 2):
OverviewPlan -> DialogueGraph -> AudioTurn[] -> speech -> alignment -> mastering -> QA

Provider-specific protocol belongs in src/providers/audio.

## Stage 2 implementation map

| Stage | Module | Notes |
| --- | --- | --- |
| Plan -> DialogueGraph | `dialogue/engine.ts` | Enriched tags (map back onto the frozen purpose per DESIGN.md §16.2 item 5), debate stances (HYPOTHESIS-grade), conversational links, beat sections, rate-model budgets; grounding validation (defense in depth over W1) |
| Personas | `dialogue/personas.ts` | Lab personas (Ava/Ben); plan speaker assignment never changes |
| Text realization | `dialogue/text/realizer.ts` | Deterministic, seeded, budgeted; fills the contract's `AudioTurn.text`; over-budget flags QA instead of dropping claims (§16.2 item 3) |
| Naturalness analysis | `dialogue/turn-taking.ts` | Parity band / run bounds / QA-link counts — QA feedback to the Director, never a rewrite (§16.2 item 4) |
| Mode conditioning | `modes/` | Rate models, gap scales, enriched-tag rules, surface overlays, QA expectations per mode; en/es language packs with honest fallback |
| Timing | `timing/` | §6 gap policy (five boundary classes, seeded jitter), TimingManifest + post-synthesis retiming |
| Mix / master | `mixing/` | WAV codec, concat + gap silence, BS.1770-4 loudness; backends: pure-TS (byte-reproducible) and ffmpeg loudnorm (+MP3) when on PATH |
| QA | `qa/` | 13 deterministic metrics (DESIGN §9 set + mode semantics + text-density fit + language honesty); typed issue codes; smallest regenerable unit ids |
| Artifact | `artifacts.ts` | GeneratedArtifact sidecar per W1 contract (no audio-side variant) |
| Public API | `index.ts` | `compileAudioOverview({plan, graph, sources, options})` |

## Usage

```ts
import { compileAudioOverview } from '../audio';
const result = await compileAudioOverview({
  plan, graph, sources,
  options: { seed: 'wflx-seed', now: '2026-01-01T00:00:00Z', mastering: 'auto' },
});
// result.turns (text-filled), .timing, .qa, .artifact, .wav, .mp3?
```

Determinism: identical (plan, graph, sources, seed, now, provider, mastering
backend) produce byte-identical outputs — enforced by
`tests/audio/determinism.test.ts`. `now` is required (no hidden wall clock).

Speech provider selection: default offline deterministic (no network, no
credentials); set `WFLX_AUDIO_SPEECH_PROVIDER=gemini` plus `GEMINI_API_KEY`
(TL-side wiring) for the real adapter — see `src/providers/audio/README.md`.

Benchmarks: `bun run audio:benchmark` regenerates `artifacts/audio/`
byte-identically (canonical 300 s run committed as sidecars + fingerprint;
short 42 s run committed with media).
