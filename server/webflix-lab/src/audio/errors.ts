/**
 * Audio pipeline (WFLX-W2, Stage 2) — typed compiler errors.
 *
 * Hard validation failures throw; soft quality problems surface as QA issues
 * in the AudioQaReport (feeding "regenerate the smallest failed unit").
 * Every thrown error carries stable codes so tests and callers can match
 * deterministically.
 */

/** One hard validation failure at the dialogue-graph level. */
export interface DialogueValidationIssue {
  /** Stable issue code, e.g. 'unknown-claim-ref'. */
  readonly code: string;
  /** Dotted path into the plan/graph, e.g. 'audioTurns.turn-6.claimIds'. */
  readonly path: string;
  readonly message: string;
  /** Smallest regenerable unit the issue belongs to, when turn-scoped. */
  readonly turnId?: string;
}

/** Typed error thrown by the audio compiler on hard failures. */
export class AudioCompilerError extends Error {
  /** Stable error code ('invalid-plan' | 'dialogue-validation-failed' | ...). */
  readonly code: string;
  /** Detailed issues when the failure is a validation failure. */
  readonly issues: readonly DialogueValidationIssue[];

  constructor(code: string, message: string, issues: readonly DialogueValidationIssue[] = []) {
    super(message);
    this.name = 'AudioCompilerError';
    this.code = code;
    this.issues = issues;
  }
}
