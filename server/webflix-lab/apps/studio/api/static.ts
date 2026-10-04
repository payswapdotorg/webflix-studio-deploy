/**
 * WebFlix-Lab Operator Studio (WFLX-UI1) — static client serving.
 *
 * The client is ZERO-BUILD: plain HTML + CSS + vanilla TypeScript. The
 * browser fetches `/app.js`, which this module produces by type-stripping
 * web/app.ts with Bun's transpiler AT REQUEST TIME (no bundler, no build
 * step, no npm dependency; the source file itself stays root-tsc-checked).
 * Only the three fixed routes below are served — no filesystem routing, no
 * traversal surface.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { errorResponse } from './errors';

/** Web assets dir. Serverless deployment layout: cwd-relative (statically
 * scoped for file tracing; see COMPAT_PATCHES.md). */
const WEB_DIR = join(process.cwd(), 'server', 'webflix-lab', 'apps', 'studio', 'web');

const INDEX_HTML = join(WEB_DIR, 'index.html');
const APP_TS = join(WEB_DIR, 'app.ts');
const STYLES_CSS = join(WEB_DIR, 'styles.css');

/** Bun.Transpiler, resolved lazily (serverless runtimes have no Bun
 *  global; there the prepare-time app.js artifact is served instead —
 *  byte-identical output, see scripts/transpile-app.ts). */
function bunTranspiler(): { transformSync(source: string): string } | null {
  const anyGlobal = globalThis as {
    Bun?: { Transpiler?: new (options: { loader: 'ts' }) => { transformSync(source: string): string } };
  };
  return anyGlobal.Bun?.Transpiler ? new anyGlobal.Bun.Transpiler({ loader: 'ts' }) : null;
}

function textResponse(body: string, contentType: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': contentType,
      'cache-control': 'no-store',
    },
  });
}

export function handleIndex(): Response {
  try {
    return textResponse(readFileSync(INDEX_HTML, 'utf8'), 'text/html; charset=utf-8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResponse(500, 'static-missing', `index.html unavailable: ${message}`);
  }
}

export function handleAppJs(): Response {
  try {
    const precompiled = join(WEB_DIR, 'app.js');
    if (existsSync(precompiled)) {
      // Prepare-time Bun.Transpiler output — byte-identical to the live
      // transpile path below (produced by scripts/transpile-app.ts).
      return textResponse(readFileSync(precompiled, 'utf8'), 'text/javascript; charset=utf-8');
    }
    const source = readFileSync(APP_TS, 'utf8');
    const transpiler = bunTranspiler();
    if (transpiler === null) {
      return errorResponse(500, 'static-missing', 'app.js artifact missing and no Bun.Transpiler available');
    }
    const js = transpiler.transformSync(source);
    return textResponse(js, 'text/javascript; charset=utf-8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResponse(500, 'static-missing', `app.ts unavailable: ${message}`);
  }
}

export function handleStyles(): Response {
  try {
    return textResponse(readFileSync(STYLES_CSS, 'utf8'), 'text/css; charset=utf-8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResponse(500, 'static-missing', `styles.css unavailable: ${message}`);
  }
}
