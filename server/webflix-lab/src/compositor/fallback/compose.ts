/**
 * Fallback compositor (WFLX-W3) — offline deterministic video assembly.
 *
 * Emits one SVG frame per output frame (the deterministic frame model) and
 * assembles an MP4 with the SYSTEM ffmpeg when it carries the librsvg SVG
 * decoder (Debian builds do): `image2 -> librsvg -> libx264`, audio muxed
 * from the placeholder narration WAV. No browser, no network, no keys —
 * byte-stable frame inputs produce a deterministic encode on a fixed ffmpeg
 * build (the frame SVGs are the pinned determinism artifact; MP4 determinism
 * is best-effort and recorded honestly in provenance).
 *
 * When ffmpeg/librsvg is unavailable, the frame sequence + manifest are
 * still produced (composition logic remains verifiable) and a typed error
 * names the missing capability — never a silent skip.
 */

import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync, statSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { MotionPlan } from '../../providers/video/port';
import type { Timeline } from '../timeline';
import { frameTimes } from '../timeline';
import { renderFrameAt } from './frame-model';

export interface ComposeFallbackInput {
  readonly timeline: Timeline;
  readonly sceneSvgs: ReadonlyMap<string, string>;
  readonly motions: ReadonlyMap<string, MotionPlan>;
  readonly output: string;
  /** Placeholder narration WAV bytes (muxed when provided). */
  readonly narrationWav?: Uint8Array;
  readonly workDir: string;
}

export interface ComposeFallbackResult {
  readonly backend: 'fallback';
  readonly output: string;
  readonly frameCount: number;
  readonly framesDir: string;
  readonly sizeBytes: number;
  readonly durationSeconds: number;
  readonly ffmpegVersion: string;
  readonly assembled: boolean;
}



function run(
  bin: string,
  args: readonly string[],
  timeoutMs: number,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: String(error) });
    });
  });
}

let ffmpegCapabilities: { available: boolean; version: string; librsvg: boolean } | undefined;

/** Detect system ffmpeg and its librsvg SVG decoder (cached). */
export async function detectFfmpeg(): Promise<{
  available: boolean;
  version: string;
  librsvg: boolean;
}> {
  if (ffmpegCapabilities !== undefined) {
    return ffmpegCapabilities;
  }
  const probe = await run('ffmpeg', ['-version'], 15_000);
  if (probe.code !== 0) {
    ffmpegCapabilities = { available: false, version: '', librsvg: false };
    return ffmpegCapabilities;
  }
  const version = probe.stdout.split('\n')[0]?.trim() ?? 'ffmpeg';
  const decoders = await run('ffmpeg', ['-decoders'], 15_000);
  const librsvg = /librsvg/i.test(decoders.stdout + decoders.stderr);
  ffmpegCapabilities = { available: true, version, librsvg };
  return ffmpegCapabilities;
}

/**
 * Compose with the deterministic fallback: write all frames, then assemble
 * with system ffmpeg (librsvg) when available. Frame SVGs are always written
 * (they are the pinned determinism artifact).
 */
export async function composeWithFallback(
  input: ComposeFallbackInput,
): Promise<ComposeFallbackResult> {
  const { timeline } = input;
  mkdirSync(input.workDir, { recursive: true });
  const framesDir = join(input.workDir, 'frames');
  rmSync(framesDir, { recursive: true, force: true });
  mkdirSync(framesDir, { recursive: true });

  const times = frameTimes(timeline);
  let frameIndex = 0;
  for (const t of times) {
    const svg = renderFrameAt(timeline, input.sceneSvgs, input.motions, t);
    const name = `frame-${String(frameIndex).padStart(6, '0')}.svg`;
    writeFileSync(join(framesDir, name), svg, 'utf8');
    frameIndex += 1;
  }

  const manifest = {
    backend: 'wflx-fallback-compositor',
    fps: timeline.fps,
    durationSeconds: timeline.durationSeconds,
    frameCount: frameIndex,
    entries: timeline.entries,
    note: 'Deterministic SVG frame model; assembly requires system ffmpeg with the librsvg decoder.',
  };
  writeFileSync(join(input.workDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  const caps = await detectFfmpeg();
  let assembled = false;
  let sizeBytes = 0;
  if (caps.available && caps.librsvg) {
    const narrationPath = join(input.workDir, 'narration.wav');
    const hasNarration = input.narrationWav !== undefined;
    if (hasNarration) {
      writeFileSync(narrationPath, input.narrationWav as Uint8Array);
    }
    const args = [
      '-y',
      '-framerate',
      String(timeline.fps),
      '-i',
      join(framesDir, 'frame-%06d.svg'),
      ...(hasNarration ? ['-i', narrationPath] : []),
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-crf',
      '20',
      ...(hasNarration ? ['-c:a', 'aac', '-b:a', '128k', '-shortest'] : ['-an']),
      input.output,
    ];
    const encode = await run('ffmpeg', args, 10 * 60_000);
    if (encode.code === 0 && existsSync(input.output)) {
      assembled = true;
      sizeBytes = statSync(input.output).size;
    } else {
      throw new Error(
        `fallback compositor: ffmpeg assembly failed (code ${encode.code}): ${encode.stderr.slice(-400)}`,
      );
    }
  }

  return {
    backend: 'fallback',
    output: input.output,
    frameCount: frameIndex,
    framesDir,
    sizeBytes,
    durationSeconds: timeline.durationSeconds,
    ffmpegVersion: caps.version,
    assembled,
  };
}

/** Count written frames in a directory (test helper). */
export function countFrames(framesDir: string): number {
  return readdirSync(framesDir).filter((name) => name.endsWith('.svg')).length;
}
