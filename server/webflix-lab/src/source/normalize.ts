/**
 * Source normalization (WFLX-W1, Stage 2).
 *
 * The canonical pipeline every text source passes through:
 *   raw -> NFC + newline canonicalization + line-trailing-space strip -> text
 *
 * This MUST stay byte-identical to the fixture builder's normalization
 * (tests/contracts/genfixtures.ts) — the markdown adapter parity test depends
 * on it. All IR offsets index into the normalized text.
 *
 * Credential hygiene: scanForCredentialShapes() detects well-known
 * credential-shaped substrings so adapters can refuse to ingest them.
 * Findings never carry the matched text itself (only pattern name, offsets
 * and length) so logs and errors stay secret-free.
 */

import { countWords as contractCountWords, sha256Hex } from '../contracts';

export function normalizeText(raw: string): string {
  return raw
    .normalize('NFC')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .trimEnd();
}

export function countWords(text: string): number {
  return contractCountWords(text);
}

export interface SourceFingerprintInput {
  raw: string;
  normalizedText: string;
}

export function fingerprintOf({ raw, normalizedText }: SourceFingerprintInput): {
  contentSha256: string;
  rawSha256: string;
  textLength: number;
} {
  return {
    contentSha256: sha256Hex(normalizedText),
    rawSha256: sha256Hex(raw),
    textLength: normalizedText.length,
  };
}

/**
 * Well-known credential shapes (prefix patterns only; safe to commit).
 * Intentionally NO generic long-hex rule: content hashes are legitimate text
 * and would produce false positives.
 */
const CREDENTIAL_PATTERNS: { name: string; pattern: RegExp }[] = [
  { name: 'github-token', pattern: /\bgh[pousr]_[A-Za-z0-9]{16,}\b/g },
  { name: 'openai-style-key', pattern: /\bsk-[A-Za-z0-9]{20,}\b/g },
  { name: 'anthropic-key', pattern: /\bsk-ant-[A-Za-z0-9-]{20,}\b/g },
  { name: 'aws-access-key', pattern: /\bAKIA[A-Z0-9]{16}\b/g },
  { name: 'slack-token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: 'google-api-key', pattern: /\bAIza[A-Za-z0-9_-]{35}\b/g },
  { name: 'private-key-block', pattern: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/g },
  { name: 'bearer-token', pattern: /\bBearer\s+[A-Za-z0-9._-]{20,}\b/g },
];

export interface CredentialFinding {
  /** Pattern name, e.g. "github-token". Never the matched text. */
  pattern: string;
  start: number;
  end: number;
  length: number;
}

export class CredentialShapeError extends Error {
  constructor(
    public readonly findings: CredentialFinding[],
  ) {
    super(
      `credential-shaped content detected (${findings.map((f) => f.pattern).join(', ')}); ` +
        'refusing to build a SourceArtifact. Redact the source or pass allowCredentialShapes after review.',
    );
    this.name = 'CredentialShapeError';
  }
}

export function scanForCredentialShapes(text: string): CredentialFinding[] {
  const findings: CredentialFinding[] = [];
  for (const { name, pattern } of CREDENTIAL_PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags);
    let match = re.exec(text);
    while (match !== null) {
      findings.push({
        pattern: name,
        start: match.index,
        end: match.index + match[0].length,
        length: match[0].length,
      });
      match = re.exec(text);
    }
  }
  findings.sort((a, b) => a.start - b.start);
  return findings;
}
