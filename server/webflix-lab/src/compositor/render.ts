/**
 * Compositor render driver (WFLX-W3) — Remotion (primary) with the
 * deterministic offline fallback.
 *
 * Primary path: bundle the registered composition (@remotion/bundler) and
 * render h264 via @remotion/renderer, pointing browserExecutable at a
 * discovered headless Chrome (Playwright's chrome-headless-shell on this
 * lab host, or an explicit WFLX_REMOTION_BROWSER path). No browser is
 * downloaded by the lab — discovery only.
 *
 * Fallback path: when no browser is discoverable, the deterministic offline
 * compositor renders the same timeline as SVG frames and assembles with
 * system ffmpeg (librsvg). Both backends share the timeline math, so
 * composition is equivalent by construction; the backend used is recorded
 * in provenance (GeneratedArtifact.providers stage 'composition').
 */

import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Id } from '../contracts';
import type { MotionPlan } from '../providers/video/port';
import type { Timeline } from './timeline';
import { composeWithFallback } from './fallback/compose';
import type { SerializedMotionPlan } from './remotion/composition';

const HERE = dirname(fileURLToPath(import.meta.url));

export type CompositionBackend = 'remotion' | 'fallback' | 'auto';

export interface ComposeVideoInput {
  readonly timeline: Timeline;
  readonly sceneSvgs: ReadonlyMap<Id, string>;
  readonly motions: ReadonlyMap<Id, MotionPlan>;
  readonly output: string;
  /** Placeholder narration WAV bytes (muxed when provided). */
  readonly narrationWav?: Uint8Array;
  readonly backend?: CompositionBackend;
  /** Explicit Chrome/Chromium path override (highest priority). */
  readonly browserExecutable?: string;
  /** Temp workspace override (tests); defaults to an OS temp dir. */
  readonly workDir?: string;
}

export interface ComposeVideoResult {
  readonly backend: 'remotion' | 'fallback';
  readonly output: string;
  readonly sizeBytes: number;
  readonly durationSeconds: number;
  readonly frameCount: number;
  readonly detail: string;
}

/** Discover a usable headless browser executable (no downloads). */
export function findHeadlessBrowser(explicit?: string): string | null {
  if (explicit !== undefined) {
    return existsSync(explicit) ? explicit : null;
  }
  const envPath = process.env.WFLX_REMOTION_BROWSER;
  if (envPath !== undefined && envPath !== '' && existsSync(envPath)) {
    return envPath;
  }
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
  if (home === '') {
    return null;
  }
  const candidates = [
    join(home, '.cache/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell'),
    join(home, '.cache/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell.exe'),
    join(home, '.cache/ms-playwright/chromium-*/chrome-linux64/chrome'),
    join(home, '.cache/ms-playwright/chromium-*/chrome-linux/chrome'),
  ];
  for (const pattern of candidates) {
    const found = globFirst(pattern);
    if (found !== null) {
      return found;
    }
  }
  return null;
}

function globFirst(pattern: string): string | null {
  const dirParts = pattern.split('/');
  let currentDirs: string[] = [];
  let root = '';
  // Handle absolute pattern start.
  if (pattern.startsWith('/')) {
    root = '/';
    currentDirs = [root];
    dirParts.shift();
  }
  for (const part of dirParts) {
    const next: string[] = [];
    for (const dir of currentDirs) {
      if (part.includes('*')) {
        const regex = new RegExp(`^${part.replaceAll('.', '\\.').replaceAll('*', '.*')}$`);
        try {
          for (const name of readdirSorted(dir)) {
            if (regex.test(name)) {
              next.push(join(dir, name));
            }
          }
        } catch {
          // Unreadable or missing dir — skip.
        }
      } else {
        const candidate = join(dir, part);
        if (existsSync(candidate)) {
          next.push(candidate);
        }
      }
    }
    currentDirs = next;
    if (currentDirs.length === 0) {
      return null;
    }
  }
  // Prefer the highest version (sorted last).
  return currentDirs[currentDirs.length - 1] ?? null;
}

function readdirSorted(dir: string): string[] {
  try {
    return readdirSync(dir).sort();
  } catch {
    return [];
  }
}

/** Compose the overview video: Remotion when a browser is available. */
export async function composeVideo(input: ComposeVideoInput): Promise<ComposeVideoResult> {
  const backend = input.backend ?? 'auto';
  const workDir = input.workDir ?? mkdtempSync(join(tmpdir(), 'wflx-video-'));
  mkdirSync(workDir, { recursive: true });
  const outputDir = dirname(input.output);
  if (outputDir !== '' && !existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const browser =
    input.browserExecutable !== undefined || backend !== 'fallback'
      ? findHeadlessBrowser(input.browserExecutable)
      : null;

  if ((backend === 'remotion' || backend === 'auto') && browser !== null) {
    return renderWithRemotion(input, workDir, browser as string);
  }
  if (backend === 'remotion' && browser === null) {
    throw new Error(
      'composeVideo: backend "remotion" requested but no headless browser found ' +
        '(set WFLX_REMOTION_BROWSER or install a Playwright chromium_headless_shell)',
    );
  }
  const fallback = await composeWithFallback({
    timeline: input.timeline,
    sceneSvgs: input.sceneSvgs,
    motions: input.motions,
    output: input.output,
    ...(input.narrationWav !== undefined ? { narrationWav: input.narrationWav } : {}),
    workDir,
  });
  return {
    backend: 'fallback',
    output: fallback.output,
    sizeBytes: fallback.sizeBytes,
    durationSeconds: fallback.durationSeconds,
    frameCount: fallback.frameCount,
    detail: `${fallback.ffmpegVersion}${fallback.assembled ? '' : ' (frames only: assembly unavailable)'}`,
  };
}

async function renderWithRemotion(
  input: ComposeVideoInput,
  workDir: string,
  browserExecutable: string,
): Promise<ComposeVideoResult> {
  // Dynamic imports keep Remotion out of the offline-only import graph.
  const { bundle } = await import('@remotion/bundler');
  const { renderMedia, selectComposition } = await import('@remotion/renderer');
  const { OVERVIEW_COMPOSITION_ID } = await import('./remotion/composition');

  const sceneSvgs: Record<string, string> = {};
  for (const [sceneId, svg] of input.sceneSvgs) {
    sceneSvgs[sceneId] = svg;
  }
  const motions: Record<string, SerializedMotionPlan> = {};
  for (const [sceneId, plan] of input.motions) {
    motions[sceneId] = {
      sceneId: plan.sceneId,
      easing: plan.easing,
      from: plan.from,
      to: plan.to,
    };
  }
  const inputProps = {
    timeline: input.timeline,
    sceneSvgs,
    motions,
    hasNarration: input.narrationWav !== undefined,
  };

  const hasNarration = input.narrationWav !== undefined;
  if (hasNarration) {
    const publicDir = join(workDir, 'public');
    mkdirSync(publicDir, { recursive: true });
    writeFileSync(join(publicDir, 'narration.wav'), input.narrationWav as Uint8Array);
  }

  const entryPoint = join(HERE, 'remotion', 'entry.ts');
  const serveUrl = await bundle({
    entryPoint,
    ...(hasNarration ? { publicDir: join(workDir, 'public') } : {}),
  });
  const composition = await selectComposition({
    serveUrl,
    id: OVERVIEW_COMPOSITION_ID,
    inputProps,
    browserExecutable,
  });
  await renderMedia({
    composition,
    serveUrl,
    codec: 'h264',
    outputLocation: input.output,
    inputProps,
    browserExecutable,
    concurrency: 2,
  });
  const { statSync } = await import('node:fs');
  return {
    backend: 'remotion',
    output: input.output,
    sizeBytes: existsSync(input.output) ? statSync(input.output).size : 0,
    durationSeconds: composition.durationInFrames / composition.fps,
    frameCount: composition.durationInFrames,
    detail: `remotion 4.0.529 + chrome-headless-shell (${browserExecutable})`,
  };
}
