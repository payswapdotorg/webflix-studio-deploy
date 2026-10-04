#!/usr/bin/env python3
"""Applies the documented compatibility patches to the vendored studio tree.

Every replacement is exact-match and fails loudly if the frozen source has
drifted. The generated COMPAT_PATCHES.md records what was changed and why.

Only TRANSPORT-level concerns are touched (runtime portability); zero
business logic is modified. The originals in the webflix-lab repo stay
untouched (frozen).
"""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent / "server" / "webflix-lab"


def patch(rel: str, replacements: list[tuple[str, str]]) -> None:
    path = ROOT / rel
    text = path.read_text(encoding="utf-8")
    for old, new in replacements:
        if text.count(old) != 1:
            sys.exit(f"FATAL: pattern not found (or not unique) in {rel}: {old[:80]!r}")
        text = text.replace(old, new)
    path.write_text(text, encoding="utf-8")
    print(f"patched: {rel} ({len(replacements)} replacement(s))")


# --- apps/studio/pipeline.ts -------------------------------------------------
# import.meta.dir is Bun-only AND opaque to the serverless file tracer.
# The deployment layout is fixed, so the vendored tree resolves statically
# from the runtime cwd (the canonical Next.js pattern; turbopack-traceable,
# keeps the function bundle scoped to server/webflix-lab/**).
patch(
    "apps/studio/pipeline.ts",
    [
        (
            "/** Repo root (apps/studio/pipeline.ts -> two levels up). */\n"
            "const REPO_ROOT = join(import.meta.dir, '..', '..');",
            "/** Repo root. On the serverless deployment the runtime cwd is the\n"
            " * project root, so the vendored tree resolves statically (keeps file\n"
            " * tracing scoped; see COMPAT_PATCHES.md). */\n"
            "const REPO_ROOT = join(process.cwd(), 'server', 'webflix-lab');",
        ),
    ],
)

# --- apps/studio/api/static.ts -----------------------------------------------
# Two Bun-only constructs: import.meta.dir (path) and Bun.Transpiler (the
# zero-build type-strip of web/app.ts at request time). The deployment
# pre-transpiles web/app.ts with the REAL Bun.Transpiler at prepare time
# (scripts/transpile-app.ts), producing byte-identical output; the patch
# serves that artifact when present and keeps the live-transpile path for
# local bun runs.
patch(
    "apps/studio/api/static.ts",
    [
        (
            "import { readFileSync } from 'node:fs';\nimport { join } from 'node:path';\nimport { errorResponse } from './errors';",
            "import { existsSync, readFileSync } from 'node:fs';\n"
            "import { join } from 'node:path';\n"
            "import { errorResponse } from './errors';",
        ),
        (
            "const WEB_DIR = join(import.meta.dir, '..', 'web');",
            "/** Web assets dir. Serverless deployment layout: cwd-relative (statically\n"
            " * scoped for file tracing; see COMPAT_PATCHES.md). */\n"
            "const WEB_DIR = join(process.cwd(), 'server', 'webflix-lab', 'apps', 'studio', 'web');",
        ),
        (
            "const transpiler = new Bun.Transpiler({ loader: 'ts' });",
            "/** Bun.Transpiler, resolved lazily (serverless runtimes have no Bun\n"
            " *  global; there the prepare-time app.js artifact is served instead —\n"
            " *  byte-identical output, see scripts/transpile-app.ts). */\n"
            "function bunTranspiler(): { transformSync(source: string): string } | null {\n"
            "  const anyGlobal = globalThis as {\n"
            "    Bun?: { Transpiler?: new (options: { loader: 'ts' }) => { transformSync(source: string): string } };\n"
            "  };\n"
            "  return anyGlobal.Bun?.Transpiler ? new anyGlobal.Bun.Transpiler({ loader: 'ts' }) : null;\n"
            "}",
        ),
        (
            "export function handleAppJs(): Response {\n"
            "  try {\n"
            "    const source = readFileSync(APP_TS, 'utf8');\n"
            "    const js = transpiler.transformSync(source);\n"
            "    return textResponse(js, 'text/javascript; charset=utf-8');",
            "export function handleAppJs(): Response {\n"
            "  try {\n"
            "    const precompiled = join(WEB_DIR, 'app.js');\n"
            "    if (existsSync(precompiled)) {\n"
            "      // Prepare-time Bun.Transpiler output — byte-identical to the live\n"
            "      // transpile path below (produced by scripts/transpile-app.ts).\n"
            "      return textResponse(readFileSync(precompiled, 'utf8'), 'text/javascript; charset=utf-8');\n"
            "    }\n"
            "    const source = readFileSync(APP_TS, 'utf8');\n"
            "    const transpiler = bunTranspiler();\n"
            "    if (transpiler === null) {\n"
            "      return errorResponse(500, 'static-missing', 'app.js artifact missing and no Bun.Transpiler available');\n"
            "    }\n"
            "    const js = transpiler.transformSync(source);\n"
            "    return textResponse(js, 'text/javascript; charset=utf-8');",
        ),
    ],
)

# --- apps/studio/api/audio.ts ------------------------------------------------
# Under @types/node 24 the DOM BodyInit requires ArrayBuffer-backed views.
# The stored masters are built by the pure-TS mixer as standalone
# ArrayBuffer-backed buffers, so narrowing the binding is typing-only
# (zero runtime change) and covers both the 206 slice and the 200 full body.
patch(
    "apps/studio/api/audio.ts",
    [
        (
            "  const wav = stored?.wav ?? sessionMaster?.wav;",
            "  // The stored masters are ArrayBuffer-backed (built by the pure-TS\n"
            "  // mixer); this narrows the ArrayBufferLike typing for DOM BodyInit\n"
            "  // under @types/node 24. Zero runtime change.\n"
            "  const wav = (stored?.wav ?? sessionMaster?.wav) as Uint8Array<ArrayBuffer> | undefined;",
        ),
    ],
)

# --- src/contracts/emit-schemas.ts --------------------------------------------
# Re-exported by src/contracts/index.ts (in the studio compile closure).
# import.meta.dir is Bun-only; the module is a prepare-time script that never
# runs serverless — a cwd-relative path keeps it typecheck-clean and statically
# traceable.
patch(
    "src/contracts/emit-schemas.ts",
    [
        (
            "  const outDir = join(import.meta.dir, 'schemas');",
            "  const outDir = join(process.cwd(), 'server', 'webflix-lab', 'src', 'contracts', 'schemas');",
        ),
    ],
)

# --- record ------------------------------------------------------------------
COMPATCH_MD = """# Vendored webflix-lab — compatibility patches

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
"""
(ROOT / "COMPAT_PATCHES.md").write_text(COMPATCH_MD, encoding="utf-8")
print("wrote: COMPAT_PATCHES.md")
