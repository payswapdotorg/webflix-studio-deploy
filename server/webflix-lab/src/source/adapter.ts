/**
 * Source adapter port (WFLX-W1, Stage 2).
 *
 * Adapters turn authorized raw content into SourceArtifacts. They own
 * provenance and normalization; they never bypass paywalls, logins, CAPTCHA,
 * DRM or access controls (AGENTS.md safety rules). Provider-specific
 * behavior stays inside adapters; the port itself is provider-neutral.
 */

import type {
  SourceArtifact,
  SourceAuthorization,
  SourceKind,
  UtcTimestamp,
} from '../contracts';

export interface IngestInput {
  /** Caller-assigned artifact id, e.g. "source-messy-note-redacted". */
  id: string;
  /** Human-readable provenance label (file name, site name). Never a secret. */
  label: string;
  /** Raw content for text adapters (markdown, plain text). */
  content?: string;
  /** Public canonical URL for article adapters (http/https only). */
  url?: string;
  /** Title override; adapters derive a title when omitted. */
  title?: string;
  /** When the content was fetched/created (UTC). Supply for reproducibility. */
  createdAt?: UtcTimestamp;
  /** Defaults to "user-provided". Article adapters force "public". */
  authorization?: SourceAuthorization;
  /**
   * Refuse (default) or allow credential-shaped content after human review.
   * Findings are reported without the matched text.
   */
  allowCredentialShapes?: boolean;
}

export interface SourceAdapter {
  readonly kind: SourceKind;
  ingest(input: IngestInput): Promise<SourceArtifact>;
}

export class AdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdapterError';
  }
}
