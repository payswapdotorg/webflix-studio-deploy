/**
 * Video pipeline (WFLX-W3) — error type.
 *
 * Mirrors W2's AudioCompilerError discipline: hard validation failures throw
 * (plan is unusable for the video surface); soft quality problems surface as
 * typed QA issues naming the smallest regenerable unit (scene id) instead.
 */

export type VideoValidationIssue = {
  readonly code: string;
  readonly message: string;
  readonly sceneId?: string;
};

export class VideoCompilerError extends Error {
  readonly issues: readonly VideoValidationIssue[];

  constructor(message: string, issues: readonly VideoValidationIssue[] = []) {
    super(message);
    this.name = 'VideoCompilerError';
    this.issues = issues;
  }
}
