# Vendored webflix-lab — compatibility patches

This tree is a **vendored copy** of `payswapdotorg/webflix-lab` at commit
`43bb077ef5073a7380b537ea50d28c518d205c16` (ALL STAGES COMPLETE: R&D, Parity,
Studio), produced by `scripts/prepare.sh` in this repository. The originals in
the webflix-lab repo are untouched (frozen).

Copied subset (the Operator Studio request-path closure + canon docs):

- `src/**` — the frozen lab machinery (contracts, source adapters, Director,
  audio compiler, interactive session)
- `apps/studio/{pipeline.ts, sessions.ts, api/**, web/**, README.md}`
- `fixtures/reference-messy-note-redacted.md` — the checked-in fixture the
  studio compiles
- `package.json`, `AGENTS.md` — provenance

## Compatibility patches (transport-level only; zero business logic touched)

| # | File | Original (Bun-only) | Patched (portable) |
|---|------|--------------------|--------------------|
| 1 | `apps/studio/pipeline.ts` | `REPO_ROOT = join(import.meta.dir, '..', '..')` | `join(process.cwd(), 'server', 'webflix-lab')` — the fixed deployment layout resolved from the runtime cwd (the canonical Next.js pattern; statically scoped so serverless file tracing stays tight) |
| 2 | `apps/studio/api/static.ts` | `WEB_DIR = join(import.meta.dir, '..', 'web')` | `join(process.cwd(), 'server', 'webflix-lab', 'apps', 'studio', 'web')` — same pattern |
| 3 | `apps/studio/api/static.ts` | module-scope `new Bun.Transpiler(...)` + request-time type-strip of `web/app.ts` | lazy `bunTranspiler()`; serves the prepare-time `web/app.js` artifact when present (byte-identical output — produced by the REAL `Bun.Transpiler` in `scripts/transpile-app.ts`) |
| 4 | `apps/studio/api/audio.ts` | `wav` binding typed `Uint8Array<ArrayBufferLike>` | typing-level narrowing `as Uint8Array<ArrayBuffer> \| undefined` (the stored masters are standalone ArrayBuffer-backed buffers from the pure-TS mixer; satisfies DOM `BodyInit` under @types/node 24; zero runtime change) |
| 5 | `src/contracts/emit-schemas.ts` | `join(import.meta.dir, 'schemas')` | `join(process.cwd(), 'server', 'webflix-lab', 'src', 'contracts', 'schemas')` (module is re-exported by the contracts index, hence in the compile closure; it is a prepare-time script and never runs serverless) |

`apps/studio/server.ts` (the local Bun.serve entry, port law 4313) is
intentionally NOT vendored: on this deployment the Next.js catch-all route
`src/app/api/[...path]/route.ts` is the HTTP entry, delegating every request
to the unmodified `handleStudioRequest(ctx, req)` fetch-API router.

## Behavior guarantees carried over

- Same fixed seeds/now constants (`STUDIO_DIRECTOR_SEED`, `STUDIO_AUDIO_SEED`,
  `STUDIO_NOW`) — compiles are byte-deterministic; the pre-baked
  `public/audio/audio-overview-1e34b2a7aba5/master.wav` equals what the local
  studio serves for the default Deep-Dive 300 s compile.
- Overview store and session registry remain **in-memory per instance**
  (the studio's design; restarts reset them). On a serverless deployment a
  cold start therefore begins with an empty store, exactly like a local
  restart; the pre-baked baseline WAV keeps the default audio path
  CDN-served regardless of instance state.
- Live speech providers stay env-gated OFF; the offline deterministic
  provider is pinned (REPRODUCED-class lab evidence — see AGENTS.md).
