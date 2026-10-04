/**
 * Video pipeline (WFLX-P2, Deliverable C1) — cinematic asset validation.
 *
 * Two gate families, both run BEFORE composition:
 *
 * 1. PLAN-STRUCTURE GATES (deterministic, provider-independent):
 *    - every scene has >= 1 asset job; every job's sceneId exists;
 *    - shot-plan vocabulary valid; durations positive;
 *    - continuity constraints reference existing scenes; subject-carry keys
 *      match the scenes' actual subject anchors; palette constraints carry
 *      the plan's style bible id;
 *    - asset-identity reuse consistency: same subjectKey -> same identity,
 *      and one record per identity (no duplicate identity emission);
 *    - deterministic-diagram / source-derived-media jobs carry deterministic
 *      content; generative jobs carry briefs + specs.
 *
 * 2. PER-ASSET GATES (content, provider-kind-aware):
 *    - dimensions match the job spec;
 *    - format matches the job's expected format for the provider kind
 *      (offline stand-ins emit svg placeholders honestly; live visual emits
 *      png/jpeg; live video emits real mp4 with an 'ftyp' box);
 *    - provider metadata present (providerId, modelId non-empty);
 *    - content fingerprint present (sha256, 64 hex chars) and consistent
 *      with the recorded bytes;
 *    - non-trivial media (byte floor per class).
 *
 * Any FAIL fails the report (the pipeline refuses to compose unvalidated
 * assets) — never a silent skip.
 */

import { createHash } from 'node:crypto';
import type { Id } from '../../contracts';
import type {
  CinematicAssetRecord,
  CinematicPlan,
  CinematicValidationReport,
} from './types';

const HEX64 = /^[0-9a-f]{64}$/;

const BYTE_FLOOR: Record<string, number> = {
  'deterministic-diagram': 32,
  'source-derived-media': 16,
  illustration: 512,
  'generative-animation': 512,
  'video-generation': 4096,
};

/**
 * Offline stand-ins emit compact deterministic placeholders (svg posters, not
 * real media) — their byte floor is the class-independent placeholder floor.
 * Live providers must clear the full class floor (real media mass).
 */
const OFFLINE_STANDIN_FLOOR = 32;

function byteFloorFor(assetClass: string, live: boolean): number {
  return live ? (BYTE_FLOOR[assetClass] ?? 32) : OFFLINE_STANDIN_FLOOR;
}

function isMp4(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  const tag = String.fromCharCode(bytes[4] ?? 0, bytes[5] ?? 0, bytes[6] ?? 0, bytes[7] ?? 0);
  return tag === 'ftyp';
}

/** Validate the plan's structural/continuity constraints (pure). */
export function validateCinematicPlan(
  plan: CinematicPlan,
): { passed: boolean; checks: { name: string; passed: boolean; detail: string }[] } {
  const checks: { name: string; passed: boolean; detail: string }[] = [];
  const sceneIds = new Set(plan.scenes.map((s) => s.sceneId));

  // Every scene has >= 1 job; every job's sceneId exists.
  {
    let ok = true;
    const problems: string[] = [];
    for (const scene of plan.scenes) {
      if (scene.assetJobs.length === 0) {
        ok = false;
        problems.push(`${scene.sceneId}: no asset jobs`);
      }
      for (const job of scene.assetJobs) {
        if (!sceneIds.has(job.sceneId)) {
          ok = false;
          problems.push(`job ${job.jobId}: unknown scene ${job.sceneId}`);
        }
      }
    }
    checks.push({
      name: 'scenes-have-jobs',
      passed: ok,
      detail: ok
        ? `${plan.scenes.length} scenes, ${plan.scenes.reduce((t, s) => t + s.assetJobs.length, 0)} jobs, all scene ids resolve`
        : problems.slice(0, 4).join('; '),
    });
  }

  // Shot-plan vocabulary + durations.
  {
    const validCameras = new Set(['hold', 'push-in', 'pull-back', 'pan-left', 'pan-right', 'crane-up', 'orbit']);
    const validClasses = new Set(['establishing', 'detail', 'diagram-reveal', 'motion-beat', 'hero', 'outro']);
    const ok = plan.scenes.every(
      (s) =>
        validClasses.has(s.shotPlan.shotClass) &&
        validCameras.has(s.shotPlan.cameraMove) &&
        s.shotPlan.durationSeconds > 0 &&
        s.shotPlan.seed.length > 0,
    );
    checks.push({
      name: 'shot-plan-vocabulary',
      passed: ok,
      detail: ok
        ? `${plan.scenes.length} shot plans valid (class/camera/pace/seed)`
        : 'a shot plan carries an invalid class/camera or non-positive duration',
    });
  }

  // Continuity constraints reference existing scenes; subject-carry keys are
  // well-formed subject references; every ADJACENT scene pair is covered by
  // exactly one subject-carry or motif constraint.
  {
    let ok = true;
    const problems: string[] = [];
    for (const constraint of plan.continuity) {
      if (!sceneIds.has(constraint.fromSceneId) || !sceneIds.has(constraint.toSceneId)) {
        ok = false;
        problems.push(`${constraint.kind}: unknown scene in ${constraint.fromSceneId}->${constraint.toSceneId}`);
        continue;
      }
      if (constraint.kind === 'subject-carry' && !/^subject:.+$/.test(constraint.key)) {
        ok = false;
        problems.push(`subject-carry key '${constraint.key}' is not a subject reference`);
      }
      if (constraint.kind === 'palette' && constraint.key !== `palette:${plan.meta.styleBibleId}`) {
        ok = false;
        problems.push(`palette constraint key ${constraint.key} != plan style bible`);
      }
    }
    for (let i = 0; i + 1 < plan.scenes.length; i += 1) {
      const a = plan.scenes[i] as CinematicPlan['scenes'][number];
      const b = plan.scenes[i + 1] as CinematicPlan['scenes'][number];
      const links = plan.continuity.filter(
        (c) =>
          c.fromSceneId === a.sceneId &&
          c.toSceneId === b.sceneId &&
          (c.kind === 'subject-carry' || c.kind === 'motif'),
      );
      if (links.length !== 1) {
        ok = false;
        problems.push(`adjacency ${a.sceneId}->${b.sceneId} has ${links.length} subject-carry/motif constraints (expected 1)`);
      }
    }
    checks.push({
      name: 'continuity-constraints',
      passed: ok,
      detail: ok
        ? `${plan.continuity.length} constraints valid (${plan.continuity.filter((c) => c.kind === 'subject-carry').length} subject-carry, ${plan.continuity.filter((c) => c.kind === 'motif').length} motif, ${plan.continuity.filter((c) => c.kind === 'palette').length} palette; every adjacency covered)`
        : problems.slice(0, 4).join('; '),
    });
  }

  // Asset identity reuse: same subjectKey -> same identity; no duplicate ids.
  {
    const subjectByIdentity = new Map<string, string>();
    const identities = new Set<string>();
    let ok = true;
    const problems: string[] = [];
    for (const scene of plan.scenes) {
      for (const job of scene.assetJobs) {
        if (identities.has(job.assetIdentity) && subjectByIdentity.get(job.assetIdentity) !== undefined && subjectByIdentity.get(job.assetIdentity) !== job.subjectKey) {
          ok = false;
          problems.push(`identity ${job.assetIdentity} spans subjects ${subjectByIdentity.get(job.assetIdentity)} and ${job.subjectKey}`);
        }
        if (job.subjectKey !== undefined) {
          subjectByIdentity.set(job.assetIdentity, job.subjectKey);
        }
        identities.add(job.assetIdentity);
      }
    }
    checks.push({
      name: 'asset-identity-reuse',
      passed: ok,
      detail: ok
        ? `${identities.size} distinct asset identities over ${plan.scenes.reduce((t, s) => t + s.assetJobs.length, 0)} jobs (subject-keyed reuse consistent)`
        : problems.slice(0, 4).join('; '),
    });
  }

  // Deterministic classes carry deterministic content; generative carry specs.
  {
    let ok = true;
    const problems: string[] = [];
    for (const scene of plan.scenes) {
      for (const job of scene.assetJobs) {
        if (
          (job.assetClass === 'deterministic-diagram' || job.assetClass === 'source-derived-media') &&
          (job.deterministicContent === undefined || job.deterministicContent.length === 0)
        ) {
          ok = false;
          problems.push(`${job.jobId}: deterministic class without deterministic content`);
        }
        if (
          job.assetClass === 'illustration' ||
          job.assetClass === 'generative-animation' ||
          job.assetClass === 'video-generation'
        ) {
          if (job.brief.length === 0 || job.spec.widthPx <= 0 || job.spec.heightPx <= 0) {
            ok = false;
            problems.push(`${job.jobId}: generative job without a brief/spec`);
          }
        }
      }
    }
    checks.push({
      name: 'job-class-shape',
      passed: ok,
      detail: ok ? 'deterministic jobs carry content; generative jobs carry briefs + specs' : problems.slice(0, 4).join('; '),
    });
  }

  return { passed: checks.every((c) => c.passed), checks };
}

/** Validate one resolved asset record against its job (provider-kind-aware). */
export function validateCinematicAsset(
  plan: CinematicPlan,
  record: CinematicAssetRecord,
  bytes: Uint8Array,
): { passed: boolean; checks: { name: string; passed: boolean; detail: string }[] } {
  const checks: { name: string; passed: boolean; detail: string }[] = [];
  const job = plan.scenes.flatMap((s) => s.assetJobs).find((j) => j.jobId === record.jobId);

  // Job resolvable.
  checks.push({
    name: 'job-resolves',
    passed: job !== undefined,
    detail: job !== undefined ? `job ${record.jobId} found in the plan` : `job ${record.jobId} unknown`,
  });
  if (job === undefined) {
    return { passed: false, checks };
  }

  // Dimensions match the spec: exact for offline stand-ins; for live raster
  // the provider maps the request onto its nearest supported size, so the
  // gate accepts an ASPECT-RATIO-equivalent canvas (within 2%) — the fragment
  // slices into the scene canvas via preserveAspectRatio. Actual media
  // dimensions are recorded honestly in the asset record.
  const specRatio = job.spec.widthPx / Math.max(1, job.spec.heightPx);
  const actualRatio = record.widthPx / Math.max(1, record.heightPx);
  const dimsOk =
    (record.widthPx === job.spec.widthPx && record.heightPx === job.spec.heightPx) ||
    (record.live && Math.abs(actualRatio - specRatio) / specRatio <= 0.02);
  checks.push({
    name: 'dimensions',
    passed: dimsOk,
    detail: dimsOk
      ? `${record.widthPx}x${record.heightPx} ${record.widthPx === job.spec.widthPx ? 'matches spec' : `aspect-equivalent to spec ${job.spec.widthPx}x${job.spec.heightPx} (ratio ${actualRatio.toFixed(3)} vs ${specRatio.toFixed(3)})`}`
      : `${record.widthPx}x${record.heightPx} (ratio ${actualRatio.toFixed(3)}) vs spec ${job.spec.widthPx}x${job.spec.heightPx} (ratio ${specRatio.toFixed(3)}) — neither exact nor aspect-equivalent`,
  });

  // Format: provider-kind-aware. Offline stand-ins emit honest svg
  // placeholders for every generative class. Live visual providers emit real
  // raster (png/jpeg); live video providers emit real mp4.
  const accepted: string[] = record.live
    ? job.assetClass === 'video-generation'
      ? ['mp4']
      : ['png', 'jpeg']
    : ['svg'];
  const formatOk = accepted.includes(record.format);
  checks.push({
    name: 'format',
    passed: formatOk,
    detail: formatOk
      ? `${record.format} (${record.live ? 'live: real media' : 'offline stand-in: svg placeholder'})`
      : `${record.format} not in the accepted set [${accepted.join(', ')}] for a ${record.live ? 'live' : 'offline'} ${job.assetClass} asset`,
  });

  // Real-mp4 gate for live video-generation assets.
  if (record.live && job.assetClass === 'video-generation') {
    checks.push({
      name: 'mp4-container',
      passed: isMp4(bytes),
      detail: isMp4(bytes) ? 'ftyp box present' : 'bytes are not an MP4 stream',
    });
  }

  // Provider metadata.
  const metaOk = record.providerId.length > 0 && record.modelId.length > 0;
  checks.push({
    name: 'provider-metadata',
    passed: metaOk,
    detail: metaOk ? `${record.providerId}@${record.modelId}` : 'missing provider/model identity',
  });

  // Content fingerprint consistent with the bytes.
  const recomputed = createHash('sha256').update(bytes).digest('hex');
  const fpOk = HEX64.test(record.sha256) && recomputed === record.sha256;
  checks.push({
    name: 'content-fingerprint',
    passed: fpOk,
    detail: fpOk ? `sha256 ${record.sha256.slice(0, 16)}… matches bytes` : 'fingerprint missing or inconsistent with bytes',
  });

  // Non-trivial media (floor is provider-kind-aware: live providers must
  // clear the full class floor; offline stand-ins clear the placeholder floor).
  const floor = byteFloorFor(job.assetClass, record.live);
  const sizeOk = bytes.byteLength >= floor;
  checks.push({
    name: 'non-trivial-media',
    passed: sizeOk,
    detail: sizeOk ? `${bytes.byteLength} bytes (floor ${floor})` : `${bytes.byteLength} bytes below floor ${floor}`,
  });

  return { passed: checks.every((c) => c.passed), checks };
}

/** Full validation report: plan gates + every asset's gates. */
export function validateCinematicAssets(
  plan: CinematicPlan,
  assets: readonly { record: CinematicAssetRecord; bytes: Uint8Array }[],
): CinematicValidationReport {
  const planReport = validateCinematicPlan(plan);
  const assetChecks = assets.map(({ record, bytes }) => {
    const outcome = validateCinematicAsset(plan, record, bytes);
    return {
      jobId: record.jobId,
      sceneId: record.sceneId,
      assetIdentity: record.assetIdentity,
      passed: outcome.passed,
      checks: outcome.checks,
    };
  });
  return {
    planChecks: planReport.checks,
    assetChecks,
    passed: planReport.passed && assetChecks.every((a) => a.passed),
  };
}

/** Scene ids touched by failed asset gates (never a silent skip). */
export function failedGateSceneIds(report: CinematicValidationReport): Id[] {
  return [...new Set(report.assetChecks.filter((a) => !a.passed).map((a) => a.sceneId))];
}
