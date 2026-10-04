# Visual Providers (WFLX-W3)

Illustration backends for the video surface. The port
(`port.ts`) is provider-neutral: requests carry the scene brief + a
StyleBible palette projection + seed; results carry an SVG **fragment**
(coordinate space `0..width / 0..height`) with **no text** — exact labels
render deterministically in `src/video/render` (annotation rule 1).

| Adapter | Kind | Selection |
| --- | --- | --- |
| `deterministic-ink.ts` | offline-deterministic (canonical) | default; no network, no keys |
| `image-model.ts` | remote-image-model (optional) | `WFLX_VISUAL_ILLUSTRATION_PROVIDER=image-model` + runtime-injected `WFLX_IMAGE_MODEL_ENDPOINT` / `WFLX_IMAGE_MODEL_KEY` |

Binding rules (mirroring the W2 speech port):

- Provider-specific request/response shapes stay inside adapters.
- Credentials are env/runtime-injected, declared via
  `requiredCredentialKeys()`, never committed; missing wiring throws —
  never a silent degrade.
- All implementations must be deterministic when seeded; the offline ink
  adapter is byte-deterministic (tests enforce). The remote adapter is
  honestly flagged non-deterministic and recorded in provenance.
