/**
 * Audio pipeline (WFLX-W2, Stage 2) — the audio QA report.
 *
 * QA emits deterministic metrics only (DESIGN.md §9): no LLM self-assessment
 * is evidence (binding). Every issue carries a stable code and, when
 * turn-scoped, the smallest regenerable unit (turn id). The report maps onto
 * the contract-level `QaSummary` that rides on `GeneratedArtifact.qa`.
 */

import type { QaIssue, QaSeverity, QaSummary } from '../../contracts';

/** One metric result with its deterministic value and issues. */
export interface AudioQaMetric {
  /** Stable metric id, e.g. 'groundedness' (DESIGN.md §9 numbering). */
  readonly metric: string;
  /** Human-readable deterministic value ('12/22 turns evidence-bearing'). */
  readonly value: string;
  readonly issues: readonly QaIssue[];
}

export type AudioQaStatus = 'passed' | 'passed-with-issues' | 'failed';

/** The full audio QA report. */
export interface AudioQaReport {
  readonly compiler: string;
  readonly planId: string;
  readonly planHash: string;
  readonly mode: string;
  readonly language: string;
  readonly seed: string;
  readonly metrics: readonly AudioQaMetric[];
  readonly status: AudioQaStatus;
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
  header: Omit<AudioQaReport, 'metrics' | 'status' | 'issueCounts' | 'issues'>,
  metrics: readonly AudioQaMetric[],
): AudioQaReport {
  const issues = metrics.flatMap((metric) => metric.issues);
  const issueCounts: Record<QaSeverity, number> = { info: 0, warning: 0, error: 0, blocker: 0 };
  for (const issue of issues) {
    issueCounts[issue.severity] += 1;
  }
  let status: AudioQaStatus = 'passed';
  if (issueCounts.warning > 0) status = 'passed-with-issues';
  if (issueCounts.error > 0 || issueCounts.blocker > 0) status = 'failed';
  return { ...header, metrics, status, issueCounts, issues };
}

/** Project the report onto the contract-level QaSummary for GeneratedArtifact. */
export function toQaSummary(report: AudioQaReport): QaSummary {
  return {
    status: report.status,
    issues: report.issues.map((issue) =>
      issue.unitId === undefined ? { ...issue } : { ...issue },
    ),
  };
}
