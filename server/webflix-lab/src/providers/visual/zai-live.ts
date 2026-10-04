/**
 * Generative visual provider (WFLX-P2, Deliverable C2 / EV-022) — ZAI live
 * image-generation adapter over the VisualGenerativeProvider port.
 *
 * A REAL production image-generation execution path through the server-side
 * `z-ai-web-dev-sdk` (a live network service — the same SDK route WFLX-P1
 * proved for TTS in EV-016). Selected via the env flag
 * `WFLX_VISUAL_PROVIDER=live-zai` (factory); the offline deterministic
 * stand-in remains the DEFAULT — zero behavior change when the flag is unset.
 *
 * Binding rules honored (port + AGENTS.md):
 * - NO credentials in code: the SDK authenticates from the ambient runtime
 *   environment (operator/TL-side wiring); this adapter declares NO required
 *   credential keys and never reads, logs or commits credential-shaped
 *   strings. Public, non-secret CONFIG (model id) may arrive via env.
 * - NEVER fakes output: transport/provider failures throw typed errors.
 * - HONEST BOUNDARY (LAB-06 discipline): live generative output is
 *   stochastic per call. Byte-identity is NOT claimed for this provider —
 *   `deterministic: false` on every result; reproducibility of the SURFACE
 *   (plan, job specs, validation structure) is what stays byte-identical.
 * - Provenance records the REAL provider + model ids actually used.
 */

/** Env var names (names only — never values) consumed by this adapter. */
export const ZAI_LIVE_VISUAL_ENV = {
  /** Factory activation flag handled in generative-factory.ts. */
  provider: 'WFLX_VISUAL_PROVIDER',
  /** Optional model-id override (public identifier, not a secret). */
  model: 'WFLX_ZAI_IMAGE_MODEL',
} as const;

/** Default model identifier for the SDK image route (public, not a secret). */
export const ZAI_LIVE_VISUAL_DEFAULT_MODEL = 'zai-image-model';

/** SDK-supported output sizes (CreateImageGenerationBody['size']). */
export const ZAI_IMAGE_SIZES = [
  '1024x1024',
  '768x1344',
  '864x1152',
  '1344x768',
  '1152x864',
  '1440x720',
  '720x1440',
] as const;
export type ZaiImageSize = (typeof ZAI_IMAGE_SIZES)[number];

import type {
  VisualAssetRequest,
  VisualAssetResult,
  VisualGenerativeCapabilities,
  VisualGenerativeOptions,
  VisualGenerativeProvider,
} from './generative-port';

/** Minimal typed shape of the SDK client surface this adapter consumes. */
interface ZaiImageClient {
  images: {
    generations: {
      create: (body: {
        model?: string;
        prompt: string;
        size?: ZaiImageSize;
      }) => Promise<{ data?: { base64?: string }[] }>;
    };
  };
}

/** Error kinds for typed failures (never silently degrade). */
export type ZaiLiveVisualErrorKind =
  | 'empty-brief'
  | 'transport'
  | 'provider-rejected'
  | 'invalid-image';

export interface ZaiLiveVisualOptions extends VisualGenerativeOptions {
  /** SDK client factory override (tests inject a fake; production uses ZAI.create()). */
  readonly clientFactory?: () => Promise<ZaiImageClient>;
}

/** Pick the SDK size closest to the requested canvas (16:9 canvases map to 1344x768). */
export function nearestSdkSize(widthPx: number, heightPx: number): ZaiImageSize {
  const ratio = widthPx / Math.max(1, heightPx);
  if (ratio > 1.85) return '1440x720';
  if (ratio > 1.45) return '1344x768';
  if (ratio > 0.9) return '1024x1024';
  if (ratio > 0.65) return '864x1152';
  return '768x1344';
}

/** Detect the raster format from magic bytes (pure). */
export function detectRasterFormat(bytes: Uint8Array): 'png' | 'jpeg' | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg';
  }
  return null;
}

/** Parse PNG IHDR / JPEG SOF dimensions (pure, dependency-free). */
export function rasterDimensions(
  bytes: Uint8Array,
): { widthPx: number; heightPx: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (detectRasterFormat(bytes) === 'png' && bytes.length >= 24) {
    return { widthPx: view.getUint32(16), heightPx: view.getUint32(20) };
  }
  if (detectRasterFormat(bytes) === 'jpeg') {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = bytes[offset + 1] ?? 0;
      // SOF0..SOF15 (except DHT/JPG/DAC).
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const height = view.getUint16(offset + 5);
        const width = view.getUint16(offset + 7);
        return { widthPx: width, heightPx: height };
      }
      const segmentLength = view.getUint16(offset + 2);
      offset += 2 + segmentLength;
    }
  }
  return null;
}

export class ZaiLiveVisualGenerative implements VisualGenerativeProvider {
  readonly id = 'zai-live-generative';
  readonly kind = 'remote-generative' as const;

  /** Public model identity recorded in asset provenance (no secrets). */
  readonly modelId: string;

  private readonly clientFactory: () => Promise<ZaiImageClient>;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private client: ZaiImageClient | undefined;

  constructor(options: ZaiLiveVisualOptions = {}, env: NodeJS.ProcessEnv = process.env) {
    this.clientFactory =
      options.clientFactory ??
      (async () => {
        // Server-side SDK import only (never client-side; binding rule).
        const { default: ZAI } = (await import('z-ai-web-dev-sdk')) as {
          default: { create(): Promise<ZaiImageClient> };
        };
        return ZAI.create();
      });
    this.modelId = options.env?.[ZAI_LIVE_VISUAL_ENV.model] ?? env[ZAI_LIVE_VISUAL_ENV.model] ?? ZAI_LIVE_VISUAL_DEFAULT_MODEL;
    this.timeoutMs = options.timeoutMs ?? 180_000;
    this.maxRetries = options.maxRetries ?? 2;
  }

  capabilities(): VisualGenerativeCapabilities {
    return { remote: true, rasterOutput: true };
  }

  requiredCredentialKeys(): readonly string[] {
    return [];
  }

  private async ensureClient(): Promise<ZaiImageClient> {
    if (this.client === undefined) {
      this.client = await this.clientFactory();
    }
    return this.client;
  }

  async generateAsset(request: VisualAssetRequest): Promise<VisualAssetResult> {
    const brief = request.brief.replace(/\s+/g, ' ').trim();
    if (brief.length === 0) {
      throw this.error('empty-brief', `job ${request.jobId} carries an empty brief`);
    }
    const client = await this.ensureClient();
    const size = nearestSdkSize(request.widthPx, request.heightPx);
    const prompt =
      `${brief} Muted graphite-toned background ${request.palette.background} with ` +
      `${request.palette.emphasis} accent light. No text, no lettering, no words in the image.`;

    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        const response = await withTimeout(
          client.images.generations.create({ prompt, size, ...(this.modelId ? { model: this.modelId } : {}) }),
          this.timeoutMs,
        );
        const b64 = response.data?.[0]?.base64;
        if (typeof b64 !== 'string' || b64.length === 0) {
          throw this.error('provider-rejected', `job ${request.jobId}: no image payload in the response`);
        }
        const bytes = new Uint8Array(Buffer.from(b64, 'base64'));
        const format = detectRasterFormat(bytes);
        if (format === null) {
          throw this.error('invalid-image', `job ${request.jobId}: payload is neither PNG nor JPEG (${bytes.byteLength} bytes)`);
        }
        const dims = rasterDimensions(bytes);
        return {
          jobId: request.jobId,
          sceneId: request.sceneId,
          bytes,
          format,
          widthPx: dims?.widthPx ?? Number(size.split('x')[0]),
          heightPx: dims?.heightPx ?? Number(size.split('x')[1]),
          providerId: this.id,
          modelId: this.modelId,
          deterministic: false,
        };
      } catch (cause) {
        lastError = cause instanceof Error ? cause : this.error('transport', String(cause));
        if (attempt < this.maxRetries) {
          await sleep(500 * (attempt + 1));
        }
      }
    }
    throw lastError ?? this.error('transport', `job ${request.jobId} failed without a recorded cause`);
  }

  /** Liveness probe: generate a tiny image through the REAL service. */
  async healthCheck(): Promise<{ ok: boolean; detail?: string }> {
    try {
      const result = await this.generateAsset({
        jobId: 'healthcheck',
        sceneId: 'healthcheck',
        assetClass: 'illustration',
        brief: 'a single small ink circle on a plain ground',
        palette: { background: '#3e4346', ink: '#f2f4f5', emphasis: '#53dfcd', warning: '#9f3b61' },
        widthPx: 1024,
        heightPx: 1024,
        seed: 'zai-live-visual-healthcheck',
      });
      return { ok: true, detail: `live: ${result.format} ${result.widthPx}x${result.heightPx}, ${result.bytes.byteLength} bytes` };
    } catch (cause) {
      return { ok: false, detail: String(cause) };
    }
  }

  private error(kind: ZaiLiveVisualErrorKind, detail: string): Error {
    const err = new Error(`zai-live-generative: ${kind}: ${detail}`) as Error & { kind?: string };
    err.name = 'ZaiLiveVisualError';
    err.kind = kind;
    return err;
  }
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
