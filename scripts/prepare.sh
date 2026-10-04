#!/usr/bin/env bash
#
# WebFlix-Lab Operator Studio — deployment preparator.
#
# Vendors the frozen webflix-lab tree (src/ + apps/studio + the checked-in
# fixture) at WFLX_HEAD into server/webflix-lab, applies the documented
# compatibility patches (see scripts/apply_patches.py + the generated
# server/webflix-lab/COMPAT_PATCHES.md), pre-transpiles the zero-build web
# client with the REAL Bun.Transpiler (byte-parity with the local :4313
# studio serving), and pre-bakes the deterministic baseline master WAV into
# public/audio/<artifactId>/master.wav.
#
# The determinism spine is preserved: the same fixed seeds/now constants run
# here in the sandbox; the baked WAV is byte-identical to what the local
# studio serves for the same compile request (asserted by the bake script's
# byte-compare against a fresh in-process compile).
#
# Requires: bash, python3, bun, and the webflix-lab checkout at WFLX_SRC.
set -euo pipefail

WFLX_SRC="${WFLX_SRC:-/home/z/WebFlix-Lab}"
WFLX_HEAD="${WFLX_HEAD:-43bb077ef5073a7380b537ea50d28c518d205c16}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$HERE"

# 0. Fail-loud provenance check.
actual_head="$(git -C "$WFLX_SRC" rev-parse HEAD)"
if [ "$actual_head" != "$WFLX_HEAD" ]; then
  echo "FATAL: $WFLX_SRC is at $actual_head, expected $WFLX_HEAD" >&2
  exit 1
fi

# 1. Vendor the frozen subset (the studio request-path import closure + docs).
rm -rf server
mkdir -p server/webflix-lab/apps/studio server/webflix-lab/fixtures
cp -R "$WFLX_SRC/src" server/webflix-lab/src
cp -R "$WFLX_SRC/apps/studio/api" server/webflix-lab/apps/studio/api
cp -R "$WFLX_SRC/apps/studio/web" server/webflix-lab/apps/studio/web
cp "$WFLX_SRC/apps/studio/pipeline.ts" "$WFLX_SRC/apps/studio/sessions.ts" \
   "$WFLX_SRC/apps/studio/README.md" server/webflix-lab/apps/studio/
cp "$WFLX_SRC/fixtures/reference-messy-note-redacted.md" server/webflix-lab/fixtures/
cp "$WFLX_SRC/package.json" "$WFLX_SRC/AGENTS.md" server/webflix-lab/
rm -f server/webflix-lab/apps/studio/web/app.js  # regenerated below

# 2. Apply the documented compatibility patches (fail-loud on drift).
python3 scripts/apply_patches.py

# 3. Byte-parity web client artifacts (the exact Bun.Transpiler output the
#    local studio produces at request time).
bun run scripts/transpile-app.ts
cp server/webflix-lab/apps/studio/web/index.html public/index.html
cp server/webflix-lab/apps/studio/web/styles.css public/styles.css
cp server/webflix-lab/apps/studio/web/app.js public/app.js

# 4. Pre-bake the deterministic baseline master WAV (CDN-served static asset).
bun run scripts/bake-baseline.ts

echo "prepare: done — vendored webflix-lab @ $WFLX_HEAD"
