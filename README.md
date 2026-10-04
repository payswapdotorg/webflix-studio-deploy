# WebFlix-Lab Operator Studio — Vercel Deployment

Public deployment of the **WebFlix-Lab Operator Studio** (the browser-testable
research surface built in [`payswapdotorg/webflix-lab`](https://github.com/payswapdotorg/webflix-lab))
so the operator can interact with it directly: **source → compile → listen →
join → ask → locality/grounding proofs**.

This repository is a **thin deployment adapter**. Zero business logic lives
here — the entire studio pipeline (source adapter → understanding → Director →
audio compile → InteractiveAudioSession) is **vendored byte-frozen** from
webflix-lab @ `43bb077` under `server/webflix-lab/`, with five documented
transport-level compatibility patches (`server/webflix-lab/COMPAT_PATCHES.md`).

## Live

**https://webflix-studio-mu.vercel.app** — production deployment (Vercel team
`tepa`, project `webflix-studio`), verified end-to-end in the browser:
compile (24 turns, deterministic artifact `audio-overview-1e34b2a7aba5`) →
listen (CDN-served byte-identical master WAV) → join → boundary 4 → typed ask
→ locality 24/24 byte-identity + F1 grounding PASS → session master streams
(329 s = 307.59 + 21.18 s exact).

## What you can do in the browser

Exactly the station-verified local journey, on a public URL:

1. **Source** — the checked-in fixture (`fixtures/reference-messy-note-redacted.md`)
   enumerated through the real `MarkdownNoteAdapter`.
2. **Compile** — Deep-Dive (300 s) / Brief / Critique / Debate through the real
   pipeline: 24 turns, byte-deterministic master WAV (offline deterministic
   speech provider, pure-TS mastering).
3. **Listen** — the compiled master WAV. The default Deep-Dive baseline is
   **pre-baked as a CDN static asset** (`public/audio/audio-overview-1e34b2a7aba5/master.wav`,
   byte-identical to the local studio's output — sha256-pinned by
   `scripts/bake-baseline.ts`).
4. **Join Interactive Audio** — establish a session over the compiled overview,
   pick a turn boundary, ask a typed listener question, and read the
   **locality proof** (24/24 original turns byte-identical, post-boundary shift
   == inserted response total), **grounding (F1)** and **provenance** panels.

Honest boundaries (unchanged from the lab): the speech is the offline
deterministic provider (placeholder audio — REPRODUCED-class lab evidence,
never product parity); voice capture stays UNRESOLVED (typed stand-in, no fake
microphone); sessions are per-instance in-memory (a restart resets them — same
as the local studio); live speech providers stay env-gated OFF.

## Repository layout

```
scripts/prepare.sh         reproducible deploy-prep: vendor + patch + transpile + pre-bake
scripts/apply_patches.py   the five documented compatibility patches (fail-loud)
scripts/transpile-app.ts   web/app.ts -> app.js with the REAL Bun.Transpiler (byte-parity)
scripts/bake-baseline.ts   deterministic baseline master WAV pre-bake
src/app/api/[...path]/route.ts   THE adapter: one catch-all -> handleStudioRequest(ctx, req)
server/webflix-lab/        vendored frozen webflix-lab @ 43bb077 (+ COMPAT_PATCHES.md)
public/                    index.html / app.js / styles.css / pre-baked baseline WAV
next.config.ts             rewrites + file tracing (function bundle scoped, public excluded)
```

## Local run

```bash
bun install
bun run vendor      # vendors + patches + transpiles + bakes (needs bun + the webflix-lab checkout)
bun run dev         # http://localhost:4321
```

`scripts/prepare.sh` fails loudly if the vendored source drifts off the pinned
commit or if any patch pattern stops matching.

## Deployment

Two paths (this repository's directory is linked to the live `tepa` project):

```bash
# the live path (tepa scope — this is how the production deploy was made):
bunx vercel deploy --prod --scope tepa --token "$VERCEL_TOKEN"

# the git path (default-team project, git-linked to this repository):
# push to main → auto-deploy, ONCE the repo is added to the Vercel GitHub
# App's repository list on payswapdotorg (GitHub → Settings → Applications →
# Vercel → Configure → Repository access). A deploy hook (`ops-deploy`) is
# armed on that project as an alternative trigger.
```

- Framework: Next.js (App Router). One dynamic route serves the entire studio
  surface; statics are CDN-served from `public/`.
- Function config: `maxDuration = 60` (the Deep-Dive 300 s compile takes
  ~5–9 s of CPU locally/serverless), Node runtime, `force-dynamic` (the studio
  surface is no-store).
- Multi-MB WAV responses (> 4 MB) stream instead of buffering (serverless
  response cap) — transport-only; bytes unchanged.
- Environment secrets on the live project are Production-scoped
  (`DATABASE_URL`, `NEON_PROJECT_ID`, `OPENROUTER_API_KEY`).

## Environment variables (armed)

| Variable | Status |
|----------|--------|
| `DATABASE_URL` (Neon Postgres) | set on the Vercel project — **armed, not wired**: the studio is in-memory by frozen design; persistence work can adopt it without re-provisioning |
| `OPENROUTER_API_KEY` | set on the Vercel project — armed for future live-LLM experiments; the studio's gated live providers are Gemini/Z.ai and stay OFF |

No secret is committed to this repository (credential sweep clean).

## Provenance

- Vendored tree: `payswapdotorg/webflix-lab` @ `43bb077ef5073a7380b537ea50d28c518d205c16`
  (roadmap complete: R&D / Parity / Studio stages, battery 502/502 at merge time).
- Patches: five, transport-level only, each documented in
  `server/webflix-lab/COMPAT_PATCHES.md` and applied by
  `scripts/apply_patches.py` (exact-match, fail-loud).
- Byte-parity guarantees: `public/app.js` is the exact `Bun.Transpiler` output
  the local studio serves; `public/audio/audio-overview-1e34b2a7aba5/master.wav`
  is the exact deterministic compile output (same fixed seeds/now constants).
