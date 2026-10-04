# Compositor (WFLX-W3)

Scene + audio timing → video composition.

```text
VideoScene[] (durations, motion, transitions)
      |
      v
timeline.ts            pure math: contiguous spans, boundary-centered
      |                crossfades, camera interpolation (shared by BOTH
      |                backends and by QA — equivalence by construction)
      |
      +--> remotion/   primary backend: React composition (createElement,
      |                no JSX — root tsconfig stays TL-owned/untouched),
      |                bundled + rendered h264 via @remotion/renderer with
      |                a DISCOVERED headless browser (never downloaded).
      |
      +--> fallback/   deterministic offline backend: one SVG per output
                       frame (same shared math) + system ffmpeg assembly
                       when the librsvg SVG decoder is present.

narration-audio.ts     placeholder narration WAV (marker tones; W2 offline
                       TTS position — NOT product parity evidence) + the
                       minimal 16-bit mono WAV encoder.
render.ts              backend selection ('auto' prefers Remotion when a
                       browser exists), browser discovery, provenance detail.
```

Transition fidelity: `cut` and `crossfade` are fully implemented; `wipe`,
`push` and `morph` render as crossfade-equivalent opacity in this phase —
none of them appear in the annotated reference (25 crossfades / 18 hard
cuts observed); documented as deferred fidelity, not silently skipped.
