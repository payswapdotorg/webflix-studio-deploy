/**
 * Video pipeline (WFLX-W3) — the QA report shape.
 *
 * Mirrors W2's audio QA report: deterministic metrics only (no LLM
 * self-assessment is evidence — binding), every issue carries a stable code
 * and the smallest regenerable unit (scene id), and the report maps onto the
 * contract-level QaSummary that rides on GeneratedArtifact.qa.
 */

import type { QaIssue, QaSeverity, QaSummary } from '../../contracts';

/** One metric result with its deterministic value and issues. */
export interface VideoQaMetric {
  /** Stable metric id (see metrics.ts for the numbered set). */
  readonly metric: string;
  /** Human-readable deterministic value. */
  readonly value: string;
  readonly issues: readonly QaIssue[];
}

export type VideoQaStatus = 'passed' | 'passed-with-issues' | 'failed';

/** The full video QA report. */
export interface VideoQaReport {
  readonly compiler: string;
  readonly planId: string;
  readonly planHash: string;
  readonly mode: string;
  readonly language: string;
  readonly seed: string;
  readonly metrics: readonly VideoQaMetric[];
  readonly status: VideoQaStatus;
  readonly issueCounts: Readonly<Record<QaSeverity, number>>;
  readonly issues: readonly QaIssue[];
}

export function qaIssue(
  severity: QaSeverity,
  code: string,
  message: string,
  unitId?: string,
): QaIssue {
  return unitId === undefined ? { severity, code, message } : { severity, code, message, unitId };
}

/** Assemble a report from metric results (deterministic order preserved). */
export function assembleReport(
  header: Omit<VideoQaReport, 'metrics' | 'status' | 'issueCounts' | 'issues'>,
  metrics: readonly VideoQaMetric[],
): VideoQaReport {
  const issues = metrics.flatMap((metric) => metric.issues);
  const issueCounts: Record<QaSeverity, number> = { info: 0, warning: 0, error: 0, blocker: 0 };
  for (const issue of issues) {
    issueCounts[issue.severity] += 1;
  }
  let status: VideoQaStatus = 'passed';
  if (issueCounts.warning > 0) {
    status = 'passed-with-issues';
  }
  if (issueCounts.error > 0 || issueCounts.blocker > 0) {
    status = 'failed';
  }
  return { ...header, metrics, status, issueCounts, issues };
}

/** Project the report onto the contract-level QaSummary. */
export function toQaSummary(report: VideoQaReport): QaSummary {
  return { status: report.status, issues: report.issues };
}
