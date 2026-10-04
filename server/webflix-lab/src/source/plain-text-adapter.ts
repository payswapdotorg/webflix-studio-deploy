/**
 * PlainTextAdapter (WFLX-W1, Stage 2).
 *
 * Lab canonical plain-text policy (documented): every non-blank line is one
 * paragraph block. This matches the Stage-1 fixture builder's line-based
 * block grammar, keeping offsets and parity tests consistent.
 */

import { CONTRACTS_VERSION, countWords, validateSourceArtifact, type SourceArtifact, type SourceBlock } from '../contracts';
import { AdapterError, type IngestInput, type SourceAdapter } from './adapter';
import { CredentialShapeError, fingerprintOf, normalizeText, scanForCredentialShapes } from './normalize';

export const PLAIN_TEXT_ADAPTER_ID = 'PlainTextAdapter@0.1.0';

export class PlainTextAdapter implements SourceAdapter {
  readonly kind = 'plain-text' as const;

  async ingest(input: IngestInput): Promise<SourceArtifact> {
    const raw = input.content;
    if (raw === undefined || raw.length === 0) {
      throw new AdapterError('PlainTextAdapter requires non-empty input.content');
    }
    if (!input.allowCredentialShapes) {
      const findings = scanForCredentialShapes(raw);
      if (findings.length > 0) throw new CredentialShapeError(findings);
    }
    const text = normalizeText(raw);
    if (text.length === 0) throw new AdapterError('normalized source text is empty');
    const blocks: SourceBlock[] = [];
    let offset = 0;
    for (const line of text.split('\n')) {
      const lineStart = offset;
      offset += line.length + 1;
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      const start = lineStart + (line.length - line.trimStart().length);
      blocks.push({
        id: `b${blocks.length + 1}`,
        kind: 'paragraph',
        text: trimmed,
        start,
        end: start + trimmed.length,
      });
    }
    if (blocks.length === 0) throw new AdapterError('source contains no non-blank lines');
    const artifact: SourceArtifact = {
      recordType: 'SourceArtifact',
      contractVersion: CONTRACTS_VERSION,
      id: input.id,
      title: input.title ?? input.label,
      provenance: {
        kind: 'plain-text',
        label: input.label,
        ...(input.url !== undefined ? { url: input.url } : {}),
        ...(input.createdAt !== undefined ? { fetchedAt: input.createdAt } : {}),
        authorization: input.authorization ?? 'user-provided',
      },
      fingerprint: fingerprintOf({ raw, normalizedText: text }),
      text,
      blocks,
      language: 'en',
      wordCount: countWords(text),
      createdAt: input.createdAt ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      normalizer: PLAIN_TEXT_ADAPTER_ID,
    };
    const deep = validateSourceArtifact(artifact);
    if (!deep.valid) {
      throw new AdapterError(`adapter produced an inconsistent artifact: ${JSON.stringify(deep.issues)}`);
    }
    return artifact;
  }
}
