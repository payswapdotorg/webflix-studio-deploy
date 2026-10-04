/**
 * Remote image-model illustration adapter (WFLX-W3) — OPTIONAL, env-gated.
 *
 * Generic OpenAI-compatible images endpoint (`POST {endpoint}` with JSON
 * `{model, prompt, size, n}` returning `data[0].b64_json`). The adapter is
 * deliberately provider-shape-agnostic: endpoint, model and API key are
 * injected via environment/configuration by TL-side runtime wiring and are
 * NEVER committed (AGENTS.md). Selecting this adapter without credentials
 * throws — it never silently degrades to another provider.
 *
 * Output normalizes the raster into an SVG fragment via a data-URI <image>
 * so the deterministic renderer can embed it uniformly. Note: remote raster
 * output is NOT byte-deterministic across calls; the adapter reports
 * `deterministic: false` and the pipeline records that honestly in
 * provenance (GeneratedArtifact.providers).
 */

import type {
  IllustrationProvider,
  IllustrationProviderCapabilities,
  IllustrationProviderOptions,
  IllustrationRequest,
  IllustrationResult,
} from './port';

const IMAGE_MODEL_PROVIDER_ID = 'remote-image-model';

export const IMAGE_MODEL_REQUIRED_KEYS = [
  'WFLX_IMAGE_MODEL_ENDPOINT',
  'WFLX_IMAGE_MODEL_KEY',
] as const;

export class RemoteImageModelIllustration implements IllustrationProvider {
  readonly id = IMAGE_MODEL_PROVIDER_ID;
  readonly kind = 'remote-image-model' as const;

  private readonly endpoint: string | undefined;
  private readonly apiKey: string | undefined;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor(options: IllustrationProviderOptions = {}, env: NodeJS.ProcessEnv = process.env) {
    this.endpoint = options.endpoint ?? env.WFLX_IMAGE_MODEL_ENDPOINT;
    // Key is read from env only; never defaulted, logged, or committed.
    this.apiKey = options.credentials?.WFLX_IMAGE_MODEL_KEY ?? env.WFLX_IMAGE_MODEL_KEY;
    this.model = env.WFLX_IMAGE_MODEL_ID ?? 'image-model-default';
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.maxRetries = options.maxRetries ?? 2;
  }

  capabilities(): IllustrationProviderCapabilities {
    return { vectorOutput: false, remote: true, maxBatchSize: 1 };
  }

  requiredCredentialKeys(): readonly string[] {
    return [...IMAGE_MODEL_REQUIRED_KEYS];
  }

  async healthCheck(): Promise<{ ok: boolean; detail?: string }> {
    if (this.endpoint === undefined || this.apiKey === undefined) {
      return {
        ok: false,
        detail:
          'missing WFLX_IMAGE_MODEL_ENDPOINT / WFLX_IMAGE_MODEL_KEY in the environment (inject via TL-side runtime wiring)',
      };
    }
    return { ok: true };
  }

  async illustrate(request: IllustrationRequest): Promise<IllustrationResult> {
    if (this.endpoint === undefined) {
      throw new Error(
        `${IMAGE_MODEL_PROVIDER_ID}: WFLX_IMAGE_MODEL_ENDPOINT is not configured; refusing to run without explicit wiring`,
      );
    }
    if (this.apiKey === undefined) {
      throw new Error(
        `${IMAGE_MODEL_PROVIDER_ID}: WFLX_IMAGE_MODEL_KEY is not configured; credentials must be injected at runtime, never committed`,
      );
    }
    const size = `${request.style.widthPx}x${request.style.heightPx}`;
    const prompt = `${request.brief} Palette: background ${request.style.background}, emphasis ${request.style.emphasis}, warning ${request.style.warning}. No text or lettering in the image.`;

    let lastError: unknown = undefined;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
          const response = await fetch(this.endpoint, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              // Authorization header value is the runtime-injected key.
              authorization: `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify({ model: this.model, prompt, size, n: 1 }),
            signal: controller.signal,
          });
          if (!response.ok) {
            throw new Error(`image model endpoint returned ${response.status}`);
          }
          const payload = (await response.json()) as {
            data?: { b64_json?: string; url?: string }[];
          };
          const b64 = payload.data?.[0]?.b64_json;
          if (b64 === undefined) {
            throw new Error('image model response carried no b64_json payload');
          }
          const fragment =
            `<image href="data:image/png;base64,${b64}" x="0" y="0" ` +
            `width="${request.style.widthPx}" height="${request.style.heightPx}" preserveAspectRatio="xMidYMid slice"/>`;
          return {
            sceneId: request.sceneId,
            fragment,
            widthPx: request.style.widthPx,
            heightPx: request.style.heightPx,
            deterministic: false,
            providerId: IMAGE_MODEL_PROVIDER_ID,
          };
        } finally {
          clearTimeout(timer);
        }
      } catch (error) {
        lastError = error;
      }
    }
    throw new Error(`${IMAGE_MODEL_PROVIDER_ID}: illustration failed after retries: ${String(lastError)}`);
  }
}
