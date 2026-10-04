# Audio Providers (W2)

Provider adapter boundary for the audio pipeline. Ownership: Worker 2, per
`docs/work-items/tl2-work-order.md`.

## Layout

| File | Stage | Role |
| --- | --- | --- |
| `port.ts` | 1 | Provider-neutral `SpeechProvider` port: multi-speaker TTS with per-speaker voice profiles, pronunciation hints, capabilities, constructor-injected credentials |
| `gemini-multi-speaker.ts` | 1 | Adapter interface for a Gemini-style native multi-speaker TTS (whole-conversation request, per-speaker voice config, style instruction, turn-aligned response) |
| `open-local-tts.ts` | 1 | Adapter interface for an open/local single-speaker TTS with voice conditioning (Chatterbox-style): one call per turn, stitching happens in mixing |
| `deterministic-offline.ts` | 2 | `DeterministicOfflineTtsAdapter` — seeded layered-sine placeholder WAV (pcm_s16le 44.1 kHz mono) with exact per-turn durations; canonical test path (no network, no credentials) |
| `gemini-multi-speaker-adapter.ts` | 2 | Thin real adapter behind the env flag: pure request/response mappings (offline-testable), constructor/env-injected `GEMINI_API_KEY` (name only declared), typed errors on missing credentials, refuses to guess whole-dialogue turn alignment |
| `factory.ts` | 2 | `WFLX_AUDIO_SPEECH_PROVIDER=offline (default) \| gemini` selection; default never touches the network |

## Rules (binding)

1. The port in `port.ts` is provider-NEUTRAL. Provider-specific
   request/response structures stay inside their adapter files and are never
   promoted to shared contracts (`src/contracts/` is W1+TL owned).
2. Credentials are constructor-injected by TL-side runtime wiring. Adapters
   declare `requiredCredentialKeys()`; credential-shaped strings must never
   appear in code, fixtures, artifacts, logs, or git history.
3. Remote adapters are THIN: pure request/response mapping plus transport.
   Mapping helpers are exported for offline unit tests. Missing credentials
   throw typed errors — adapters never fake audio.
4. The offline deterministic adapter is the only provider the test suite
   may depend on; every test must pass without network or API keys.
5. Environment note (DOCUMENTED, verified at Stage 1 time): `ffmpeg` 7.1.5
   is available at `/usr/bin/ffmpeg` in the lab environment and is the
   preferred mastering path for Stage 2; a pure-TS WAV fallback remains for
   portability and cross-checking.

## Related

- Architecture: `src/audio/DESIGN.md` (see §16 for contract alignment with
  Worker 1's frozen IR)
- Testable mode semantics: `tests/audio/mode-semantics.md`
- Adapter strategy in the research digest: `docs/notebooklm-overviews-research.md`

## Contract alignment note (Stage 1 addendum)

Against `work/wflx-w1-contracts` @ `78be437` the port needs no changes:
`SpeakerId` maps directly to plan `speakerRole` values (`host-a`, `host-b`,
...); `SpeechTurnRequest.text` carries the W2-filled `AudioTurn.text`;
pronunciation hints derive from `EvidenceSpan` quotes; `GeneratedArtifact`'s
`ProviderUsage`/`QaIssue` fields cover the provenance sidecar W2 emits.

## Stage 2 status

All adapters are implemented. The offline deterministic adapter is the only
provider the test suite depends on (rule 4); the Gemini adapter's pure
mappings are unit-tested offline and its live transport requires TL-side
credential wiring — its real-endpoint behavior is UNRESOLVED until a
TL-operated run records evidence. Whole-dialogue synthesis throws a typed
`alignment-mismatch` (generateContent returns no per-turn timestamps); use
per-turn `synthesizeTurn` (smallest regenerable unit).
