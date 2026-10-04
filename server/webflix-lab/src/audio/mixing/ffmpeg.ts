/**
 * Audio pipeline (WFLX-W2, Stage 2) — ffmpeg availability and transport.
 *
 * ffmpeg is the preferred mastering path when available on PATH (DOCUMENTED:
 * verified `ffmpeg` 7.1.5 at /usr/bin/ffmpeg in the lab environment at
 * Stage 1; re-checked at runtime so the pipeline stays portable). The pure-TS
 * path remains the fallback and cross-check (DESIGN.md §7).
 */

import { spawnSync } from 'node:child_process';

let cachedAvailable: boolean | undefined;
let cachedVersion: string | undefined;

/** Probe ffmpeg on PATH (cached per process). */
export function ffmpegAvailable(): boolean {
  if (cachedAvailable === undefined) {
    const probe = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
    cachedAvailable = probe.status === 0;
    if (cachedAvailable && probe.stdout !== undefined) {
      const match = /ffmpeg version (\S+)/.exec(probe.stdout);
      cachedVersion = match?.[1];
    }
  }
  return cachedAvailable;
}

/** ffmpeg version string when available (for honest provenance). */
export function ffmpegVersion(): string | undefined {
  if (cachedAvailable === undefined) {
    ffmpegAvailable();
  }
  return cachedVersion;
}

export interface FfmpegRunResult {
  readonly ok: boolean;
  readonly stderr: string;
}

/** Run ffmpeg with args; returns ok + trimmed stderr. */
export function runFfmpeg(args: readonly string[]): FfmpegRunResult {
  const run = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return { ok: run.status === 0, stderr: (run.stderr ?? '').trim() };
}
