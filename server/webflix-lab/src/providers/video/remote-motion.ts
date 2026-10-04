/**
 * Remote motion/video-model adapter (WFLX-W3) — OPTIONAL, env-gated.
 *
 * A credential-safe shell for future video-generation backends: parametric
 * motion still comes from the deterministic planner (planMotion delegates);
 * `generateClip` posts to an OpenAI-compatible video endpoint configured
 * entirely via environment (endpoint, key, model) injected by TL-side runtime
 * wiring. No credentials are ever committed; selection without wiring throws.
 *
 * The lab does not exercise this adapter in its canonical path — the work
 * order marks the motion/video provider optional and the annotation shows
 * the reference's motion is deliberate and rare, which parametric motion
 * already reproduces. Status: UNRESOLVED vs the reference's true generation
 * pipeline (no claim is made about Google's internals).
 */

import { DeterministicMotionProvider } from './deterministic-motion';
import type {
  MotionPlan,
  MotionPlanRequest,
  MotionProvider,
  MotionProviderCapabilities,
  MotionProviderOptions,
} from './port';

const REMOTE_MOTION_PROVIDER_ID = 'remote-video-model';

export const REMOTE_MOTION_REQUIRED_KEYS = [
  'WFLX_VIDEO_MODEL_ENDPOINT',
  'WFLX_VIDEO_MODEL_KEY',
] as const;

export class RemoteVideoModelMotion implements MotionProvider {
  readonly id = REMOTE_MOTION_PROVIDER_ID;
  readonly kind = 'remote-video-model' as const;

  private readonly fallback: DeterministicMotionProvider =
    new DeterministicMotionProvider();
  private readonly endpoint: string | undefined;
  private readonly apiKey: string | undefined;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(options: MotionProviderOptions = {}, env: NodeJS.ProcessEnv = process.env) {
    this.endpoint = options.endpoint ?? env.WFLX_VIDEO_MODEL_ENDPOINT;
    this.apiKey = options.credentials?.WFLX_VIDEO_MODEL_KEY ?? env.WFLX_VIDEO_MODEL_KEY;
    this.model = env.WFLX_VIDEO_MODEL_ID ?? 'video-model-default';
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  capabilities(): MotionProviderCapabilities {
    return { parametricMotion: true, generatedClips: true, remote: true };
  }

  requiredCredentialKeys(): readonly string[] {
    return [...REMOTE_MOTION_REQUIRED_KEYS];
  }

  /** Parametric planning stays deterministic (delegated). */
  async planMotion(request: MotionPlanRequest): Promise<MotionPlan> {
    return this.fallback.planMotion(request);
  }

  async generateClip(
    request: MotionPlanRequest & { readonly brief: string },
  ): Promise<{ readonly mp4Base64: string; readonly deterministic: boolean }> {
    if (this.endpoint === undefined || this.apiKey === undefined) {
      throw new Error(
        `${REMOTE_MOTION_PROVIDER_ID}: WFLX_VIDEO_MODEL_ENDPOINT / WFLX_VIDEO_MODEL_KEY ` +
          'are not configured; credentials must be injected at runtime, never committed',
      );
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          prompt: request.brief,
          duration_seconds: request.durationSeconds,
          size: `${request.canvasWidthPx}x${request.canvasHeightPx}`,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`video model endpoint returned ${response.status}`);
      }
      const payload = (await response.json()) as { video_b64?: string; data?: { b64_json?: string }[] };
      const b64 = payload.video_b64 ?? payload.data?.[0]?.b64_json;
      if (b64 === undefined) {
        throw new Error('video model response carried no video payload');
      }
      return { mp4Base64: b64, deterministic: false };
    } finally {
      clearTimeout(timer);
    }
  }
}
