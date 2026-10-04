/**
 * Generative video provider (WFLX-P2, Deliverable C2 / EV-022) — ZAI live
 * video-generation adapter over the VideoGenerativeProvider port.
 *
 * A REAL production video-generation execution path through the server-side
 * `z-ai-web-dev-sdk` (video.generations.create -> async.result.query poll ->
 * download). Selected via `WFLX_VIDEO_PROVIDER=live-zai` (factory); the
 * offline deterministic stand-in remains the DEFAULT.
 *
 * The SDK route is an ASYNC task service: create returns a task id with
 * status PROCESSING; results arrive by polling async.result.query until
 * SUCCESS (video_result[].url) or FAIL. This adapter implements the full
 * bounded-poll loop with a configurable budget and throws typed errors on
 * timeout/failure — it NEVER fakes a clip and never silently degrades.
 *
 * HONEST BOUNDARY: live generative video is stochastic per call;
 * `deterministic: false` on every result; wall-clock polling and download
 * latency are recorded as measured observables only.
 */

/** Env var names (names only — never values) consumed by this adapter. */
export const ZAI_LIVE_VIDEO_ENV = {
  /** Factory activation flag handled in generative-factory.ts. */
  provider: 'WFLX_VIDEO_PROVIDER',
  /** Optional model-id override (public identifier, not a secret). */
  model: 'WFLX_ZAI_VIDEO_MODEL',
} as const;

/** Default model identifier for the SDK video route (public, not a secret). */
export const ZAI_LIVE_VIDEO_DEFAULT_MODEL = 'zai-video-model';

import type {
  VideoGenerationRequest,
  VideoGenerationResult,
  VideoGenerativeCapabilities,
  VideoGenerativeOptions,
  VideoGenerativeProvider,
} from './generative-port';

/** Minimal typed shape of the SDK client surface this adapter consumes. */
interface ZaiVideoClient {
  video: {
    generations: {
      create: (body: {
        model?: string;
        prompt?: string;
        with_audio?: boolean;
        watermark_enabled?: boolean;
      }) => Promise<{ id?: string; task_status?: string }>;
    };
  };
  async: {
    result: {
      query: (taskId: string) => Promise<{
        task_status?: string;
        video_result?: { url: string }[];
        video_url?: string;
        url?: string;
        video?: string;
      }>;
    };
  };
}

export type ZaiLiveVideoErrorKind =
  | 'empty-brief'
  | 'task-create-failed'
  | 'task-failed'
  | 'task-timeout'
  | 'no-result-url'
  | 'download-failed'
  | 'invalid-clip';

export interface ZaiLiveVideoOptions extends VideoGenerativeOptions {
  /** SDK client factory override (tests inject a fake; production uses ZAI.create()). */
  readonly clientFactory?: () => Promise<ZaiVideoClient>;
  /** Poll interval between async-result queries (default 5 s; tests shrink it). */
  readonly pollIntervalMs?: number;
}

export class ZaiLiveVideoGenerative implements VideoGenerativeProvider {
  readonly id = 'zai-live-video';
  readonly kind = 'remote-video-model' as const;

  /** Public model identity recorded in asset provenance (no secrets). */
  readonly modelId: string;

  private readonly clientFactory: () => Promise<ZaiVideoClient>;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly pollBudgetMs: number;
  private readonly pollIntervalMs: number;
  private client: ZaiVideoClient | undefined;

  constructor(options: ZaiLiveVideoOptions = {}, env: NodeJS.ProcessEnv = process.env) {
    this.clientFactory =
      options.clientFactory ??
      (async () => {
        // Server-side SDK import only (never client-side; binding rule).
        const { default: ZAI } = (await import('z-ai-web-dev-sdk')) as {
          default: { create(): Promise<ZaiVideoClient> };
        };
        return ZAI.create();
      });
    this.modelId = env[ZAI_LIVE_VIDEO_ENV.model] ?? ZAI_LIVE_VIDEO_DEFAULT_MODEL;
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.maxRetries = options.maxRetries ?? 1;
    this.pollBudgetMs = options.pollBudgetMs ?? 480_000;
    this.pollIntervalMs = options.pollIntervalMs ?? 5_000;
  }

  capabilities(): VideoGenerativeCapabilities {
    return { remote: true, realClips: true };
  }

  requiredCredentialKeys(): readonly string[] {
    return [];
  }

  private async ensureClient(): Promise<ZaiVideoClient> {
    if (this.client === undefined) {
      this.client = await this.clientFactory();
    }
    return this.client;
  }

  async generateClip(request: VideoGenerationRequest): Promise<VideoGenerationResult> {
    const brief = request.brief.replace(/\s+/g, ' ').trim();
    if (brief.length === 0) {
      throw this.error('empty-brief', `job ${request.jobId} carries an empty brief`);
    }
    const client = await this.ensureClient();
    const prompt =
      `${brief} Cinematic motion shot, approximately ${Math.round(request.durationSeconds)} seconds. ` +
      'No text overlays, no captions, no lettering.';

    // 1. Create the async task.
    const create = await withTimeout(
      client.video.generations.create({
        prompt,
        with_audio: false,
        watermark_enabled: false,
        ...(this.modelId ? { model: this.modelId } : {}),
      }),
      this.timeoutMs,
    );
    const taskId = create.id;
    if (typeof taskId !== 'string' || taskId.length === 0) {
      throw this.error('task-create-failed', `job ${request.jobId}: service returned no task id (${JSON.stringify(create)})`);
    }

    // 2. Poll to completion within the budget.
    const startedAt = Date.now();
    let lastStatus = create.task_status ?? 'PROCESSING';
    let resultUrl: string | undefined;
    while (Date.now() - startedAt < this.pollBudgetMs) {
      await sleep(this.pollIntervalMs);
      const status = await withTimeout(client.async.result.query(taskId), this.timeoutMs);
      lastStatus = status.task_status ?? lastStatus;
      const url = status.video_result?.[0]?.url ?? status.video_url ?? status.url ?? status.video;
      if (typeof url === 'string' && url.length > 0) {
        resultUrl = url;
        break;
      }
      if (status.task_status === 'FAIL') {
        throw this.error('task-failed', `job ${request.jobId}: task ${taskId} FAILED`);
      }
    }
    if (resultUrl === undefined) {
      throw this.error(
        'task-timeout',
        `job ${request.jobId}: task ${taskId} still '${lastStatus}' after ${Math.round((Date.now() - startedAt) / 1000)}s (poll budget ${Math.round(this.pollBudgetMs / 1000)}s)`,
      );
    }

    // 3. Download the clip bytes.
    let bytes: Uint8Array;
    try {
      const response = await withTimeout(fetch(resultUrl), this.timeoutMs);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      bytes = new Uint8Array(await response.arrayBuffer());
    } catch (cause) {
      throw this.error('download-failed', `job ${request.jobId}: fetching ${resultUrl}: ${String(cause)}`);
    }
    if (!isMp4(bytes)) {
      throw this.error('invalid-clip', `job ${request.jobId}: downloaded ${bytes.byteLength} bytes that are not an MP4 stream`);
    }
    return {
      jobId: request.jobId,
      sceneId: request.sceneId,
      bytes,
      format: 'mp4',
      widthPx: request.widthPx,
      heightPx: request.heightPx,
      providerId: this.id,
      modelId: this.modelId,
      deterministic: false,
      durationSeconds: request.durationSeconds,
    };
  }

  /** Liveness probe: create + poll a minimal task through the REAL service. */
  async healthCheck(): Promise<{ ok: boolean; detail?: string }> {
    try {
      const client = await this.ensureClient();
      const task = await withTimeout(
        client.video.generations.create({ prompt: 'a still graphite-toned title card', with_audio: false }),
        this.timeoutMs,
      );
      return {
        ok: typeof task.id === 'string',
        detail: `task ${task.id ?? 'n/a'} status ${task.task_status ?? 'n/a'}`,
      };
    } catch (cause) {
      return { ok: false, detail: String(cause) };
    }
  }

  private error(kind: ZaiLiveVideoErrorKind, detail: string): Error {
    const err = new Error(`zai-live-video: ${kind}: ${detail}`) as Error & { kind?: string };
    err.name = 'ZaiLiveVideoError';
    err.kind = kind;
    return err;
  }
}

/** MP4 container check: 'ftyp' box in the first bytes (pure). */
export function isMp4(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  const tag = String.fromCharCode(bytes[4] ?? 0, bytes[5] ?? 0, bytes[6] ?? 0, bytes[7] ?? 0);
  return tag === 'ftyp';
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs} ms`)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (cause) => {
        clearTimeout(timer);
        reject(cause);
      },
    );
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
