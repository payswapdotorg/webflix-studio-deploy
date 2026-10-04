/**
 * MarkdownNoteAdapter (WFLX-W1, Stage 2).
 *
 * Line-based markdown block parsing, byte-compatible with the Stage-1
 * fixture builder (tests/source/markdown-adapter.test.ts enforces parity
 * with fixtures/contracts/reference-messy-note.source-artifact.json):
 * - each non-blank line is exactly one block;
 * - heading lines (#..######) become heading blocks with level;
 * - list lines (-, *, +) become list-item blocks;
 * - everything else becomes paragraph blocks;
 * - block spans include markdown markers so text.slice(start, end) === block.text.
 *
 * Limitations (deliberate, documented): no multi-line paragraph merging, no
 * nested lists, no code fences, no block quotes. The redacted reference
 * fixture uses none of these; extending the grammar requires regenerating
 * the canonical fixtures (a contract-visible change, TL sign-off).
 */

import { CONTRACTS_VERSION, countWords, validateSourceArtifact, type SourceArtifact, type SourceBlock } from '../contracts';
import { AdapterError, type IngestInput, type SourceAdapter } from './adapter';
import { CredentialShapeError, fingerprintOf, normalizeText, scanForCredentialShapes } from './normalize';

export const MARKDOWN_NOTE_ADAPTER_ID = 'MarkdownNoteAdapter@0.1.0';

export function parseMarkdownBlocks(text: string): SourceBlock[] {
  const blocks: SourceBlock[] = [];
  let offset = 0;
  for (const line of text.split('\n')) {
    const lineStart = offset;
    offset += line.length + 1; // +1 for the newline
    if (line.trim().length === 0) continue;
    const start = lineStart + (line.length - line.trimStart().length);
    const content = line.trim();
    const end = start + content.length;
    const heading = /^#{1,6}\s/.exec(content);
    if (heading) {
      const level = heading[0].trim().length;
      blocks.push({ id: `b${blocks.length + 1}`, kind: 'heading', text: content, start, end, level });
    } else if (/^[-*+]\s/.test(content)) {
      blocks.push({ id: `b${blocks.length + 1}`, kind: 'list-item', text: content, start, end });
    } else {
      blocks.push({ id: `b${blocks.length + 1}`, kind: 'paragraph', text: content, start, end });
    }
  }
  return blocks;
}

export class MarkdownNoteAdapter implements SourceAdapter {
  readonly kind = 'markdown-note' as const;

  async ingest(input: IngestInput): Promise<SourceArtifact> {
    const raw = input.content;
    if (raw === undefined || raw.length === 0) {
      throw new AdapterError('MarkdownNoteAdapter requires non-empty input.content');
    }
    if (!input.allowCredentialShapes) {
      const findings = scanForCredentialShapes(raw);
      if (findings.length > 0) throw new CredentialShapeError(findings);
    }
    const text = normalizeText(raw);
    if (text.length === 0) throw new AdapterError('normalized source text is empty');
    const blocks = parseMarkdownBlocks(text);
    if (blocks.length === 0) throw new AdapterError('source contains no non-blank lines');
    const title =
      input.title ??
      blocks.find((b) => b.kind === 'heading' && b.level === 1)?.text.replace(/^#\s+/, '') ??
      input.label;
    const artifact: SourceArtifact = {
      recordType: 'SourceArtifact',
      contractVersion: CONTRACTS_VERSION,
      id: input.id,
      title,
      provenance: {
        kind: 'markdown-note',
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
      normalizer: MARKDOWN_NOTE_ADAPTER_ID,
    };
    const deep = validateSourceArtifact(artifact);
    if (!deep.valid) {
      throw new AdapterError(`adapter produced an inconsistent artifact: ${JSON.stringify(deep.issues)}`);
    }
    return artifact;
  }
}
