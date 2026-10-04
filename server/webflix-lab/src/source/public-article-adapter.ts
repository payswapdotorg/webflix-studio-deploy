/**
 * PublicArticleAdapter (WFLX-W1, Stage 2).
 *
 * public article / Substack URL -> fetch -> canonical metadata -> readable
 * text extraction -> SourceArtifact (docs/overview-studio-architecture.md
 * text-source extension path).
 *
 * Authorization posture (AGENTS.md): only publicly served content; no
 * paywall, login, CAPTCHA, DRM or access-control bypass; JS-rendered pages
 * and blocked pages are detected and rejected. DOCUMENTED Gemini Notebook
 * behavior for comparison: web URL sources import text content, not
 * embedded media, and paywalled pages are unsupported.
 *
 * No headless browser: see src/source/html.ts for extraction limitations.
 */

import { CONTRACTS_VERSION, countWords, validateSourceArtifact, type SourceArtifact } from '../contracts';
import { AdapterError, type IngestInput, type SourceAdapter } from './adapter';
import { extractReadableArticle, ArticleExtractionError } from './html';
import { parseMarkdownBlocks } from './markdown-note-adapter';
import { CredentialShapeError, fingerprintOf, normalizeText, scanForCredentialShapes } from './normalize';

export const PUBLIC_ARTICLE_ADAPTER_ID = 'PublicArticleAdapter@0.1.0';

const FETCH_TIMEOUT_MS = 15_000;
const MAX_HTML_BYTES = 2_000_000;

export class PublicArticleAdapter implements SourceAdapter {
  readonly kind = 'public-article' as const;

  async ingest(input: IngestInput): Promise<SourceArtifact> {
    const url = input.url;
    if (url === undefined || url.length === 0) {
      throw new AdapterError('PublicArticleAdapter requires input.url');
    }
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new AdapterError(`invalid URL: redacted-for-safety (not echoed)`);
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new AdapterError('only http(s) URLs are supported');
    }

    let response: Response;
    try {
      response = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { 'user-agent': 'WebFlix-Lab/0.1 (research source adapter)' },
      });
    } catch (e) {
      throw new AdapterError(`fetch failed: ${(e as Error).name}`);
    }
    if (!response.ok) {
      throw new AdapterError(`fetch returned HTTP ${response.status}`);
    }
    const contentType = response.headers.get('content-type') ?? '';
    if (!/text\/html|application\/xhtml\+xml|text\/plain/i.test(contentType)) {
      throw new AdapterError(`unsupported content-type: ${contentType.split(';')[0] ?? 'unknown'}`);
    }
    const html = await response.text();
    if (html.length > MAX_HTML_BYTES) {
      throw new AdapterError(`HTML too large (${html.length} bytes > ${MAX_HTML_BYTES})`);
    }

    let extracted;
    try {
      extracted = extractReadableArticle(html);
    } catch (e) {
      if (e instanceof ArticleExtractionError) {
        throw new AdapterError(`article extraction failed: ${e.message}`);
      }
      throw e;
    }

    const text = normalizeText(extracted.text);
    if (!input.allowCredentialShapes) {
      const findings = scanForCredentialShapes(text);
      if (findings.length > 0) throw new CredentialShapeError(findings);
    }
    const blocks = parseMarkdownBlocks(text);
    if (blocks.length === 0) throw new AdapterError('extracted article contains no blocks');

    const artifact: SourceArtifact = {
      recordType: 'SourceArtifact',
      contractVersion: CONTRACTS_VERSION,
      id: input.id,
      title: input.title ?? extracted.title,
      provenance: {
        kind: 'public-article',
        label: parsed.host,
        url: parsed.toString(),
        fetchedAt: input.createdAt ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
        authorization: 'public',
      },
      fingerprint: fingerprintOf({ raw: html, normalizedText: text }),
      text,
      blocks,
      language: 'en',
      wordCount: countWords(text),
      createdAt: input.createdAt ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      normalizer: PUBLIC_ARTICLE_ADAPTER_ID,
    };
    const deep = validateSourceArtifact(artifact);
    if (!deep.valid) {
      throw new AdapterError(`adapter produced an inconsistent artifact: ${JSON.stringify(deep.issues)}`);
    }
    return artifact;
  }
}
