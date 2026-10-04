# Video (Motion) Providers (WFLX-W3, optional stage)

Motion backends for the compositor. The default path is PARAMETRIC MOTION:
`deterministic-motion.ts` plans camera moves (pan/zoom/parallax/
animated-diagram) as pure functions of (motion intent, seed, canvas) with
gentle bounds (pan ≤ ±4% of canvas, zoom +3–8%), matching the annotation
finding that reference motion is deliberate and rare (37/49 segments
static).

| Adapter | Kind | Selection |
| --- | --- | --- |
| `deterministic-motion.ts` | offline-deterministic (canonical) | default |
| `remote-motion.ts` | remote-video-model (optional shell) | `WFLX_VIDEO_MOTION_PROVIDER=remote` + runtime-injected `WFLX_VIDEO_MODEL_ENDPOINT` / `WFLX_VIDEO_MODEL_KEY` |

`remote-motion.ts` exists to prove the port boundary (credentials never
committed; parametric planning still deterministic; clip generation
requires explicit wiring and is UNRESOLVED vs the reference — no claim is
made about Google's internals). The lab does not exercise it in the
canonical path.
