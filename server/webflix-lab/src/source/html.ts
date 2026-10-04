/**
 * HTML readable-text extraction (WFLX-W1, Stage 2).
 *
 * Regex-based, no DOM library and no headless browser (deliberate scaffold
 * scope). Converts server-rendered HTML into the lab's markdown-ish block
 * grammar so the same downstream parser applies:
 *   h1-h6 -> "# ...", li -> "- ...", everything else -> plain lines.
 *
 * Documented limitations:
 * - JavaScript-rendered pages yield little/no text (detected and rejected).
 * - No paywall/login/DRM bypass; blocked pages are detected and rejected.
 * - Not a general HTML parser: malformed markup can degrade extraction.
 */

const BLOCK_BOUNDARY = /<\/(p|div|section|article|main|blockquote|ul|ol|li|table|thead|tbody|tr|figure|figcaption|h[1-6])>/gi;

export interface ExtractedArticle {
  title: string;
  /** Markdown-ish text: one line per block, headings prefixed with #. */
  text: string;
}

export class ArticleExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArticleExtractionError';
  }
}

function decodeEntities(text: string): string {
  const named: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    hellip: '…',
    mdash: '—',
    ndash: '–',
    rsquo: '’',
    lsquo: '‘',
    ldquo: '“',
    rdquo: '”',
  };
  return text
    .replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, entity: string) => {
      if (entity.startsWith('#x') || entity.startsWith('#X')) {
        const code = Number.parseInt(entity.slice(2), 16);
        return Number.isNaN(code) ? whole : String.fromCodePoint(code);
      }
      if (entity.startsWith('#')) {
        const code = Number.parseInt(entity.slice(1), 10);
        return Number.isNaN(code) ? whole : String.fromCodePoint(code);
      }
      const named2 = named[entity.toLowerCase()];
      return named2 ?? whole;
    });
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ' '));
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Extract readable article text from server-rendered HTML. */
export function extractReadableArticle(html: string): ExtractedArticle {
  let s = html
    // Remove comments and non-content regions entirely.
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(
      /<(script|style|noscript|svg|template|iframe|form|nav|header|footer|aside)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
      '',
    )
    .replace(/<(script|style|noscript|svg|template|iframe|form|nav|header|footer|aside)\b[^>]*\/>/gi, '');

  const rawTitle = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(s)?.[1];
  const ogTitle = /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i.exec(s)?.[1];
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(s)?.[1];
  const title = collapse(decodeEntities(ogTitle ?? rawTitle ?? h1 ?? ''));
  if (title.length === 0) {
    throw new ArticleExtractionError('could not determine an article title');
  }

  // Structural conversion into the markdown-ish line grammar.
  s = s
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1\s*>/gi, (_m, level: string, inner: string) => {
      return `\n${'#'.repeat(Number(level))} ${collapse(stripTags(inner))}\n`;
    })
    .replace(/<li[^>]*>([\s\S]*?)<\/li\s*>/gi, (_m, inner: string) => {
      const content = collapse(stripTags(inner));
      return content.length > 0 ? `\n- ${content}\n` : '\n';
    })
    .replace(BLOCK_BOUNDARY, '\n')
    .replace(/<br\s*\/?>/gi, '\n');

  const lines = s
    .split('\n')
    .map((line) => collapse(decodeEntities(line.replace(/<[^>]+>/g, ' '))))
    .filter((line) => line.length > 0);

  const text = lines.join('\n').trim();
  if (text.length < 40) {
    throw new ArticleExtractionError(
      `extracted text too short (${text.length} chars); the page is likely JavaScript-rendered or blocked`,
    );
  }
  if (text.length < 400 && /\b(log ?in|sign ?in|subscribe|paywall|create an account|access denied)\b/i.test(text)) {
    throw new ArticleExtractionError(
      'page looks like a login/paywall gate; the lab never bypasses access controls',
    );
  }
  return { title: title.slice(0, 300), text };
}
