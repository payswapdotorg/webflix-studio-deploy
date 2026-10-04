# Source Intelligence

Worker 1 owns this tree. Stage-2 implementation (WFLX-W1):

- `normalize.ts` — canonical normalization (NFC + newline canonicalization +
  line-trailing-space strip; byte-compatible with the Stage-1 fixture
  builder) plus the credential-shape scanner. Adapters refuse
  credential-shaped content by default (`allowCredentialShapes` opts in after
  human review); findings never carry the matched text.
- `adapter.ts` — the `SourceAdapter` port (`IngestInput` -> `SourceArtifact`).
- `markdown-note-adapter.ts` — line-based markdown block grammar; reproduces
  the canonical fixture byte-identically (adapter-parity test).
- `plain-text-adapter.ts` — lab policy: every non-blank line is one
  paragraph block.
- `public-article-adapter.ts` — public article/Substack URL -> fetch ->
  readable-text extraction -> SourceArtifact. Only publicly served content;
  login/paywall/JS-rendered pages are detected and rejected; never bypasses
  access controls. No headless browser (see `html.ts` limitations).
- `graph/extractor.ts` — the provider-neutral `LlmExtractor` PORT. Real LLM
  adapters are a later TL-side decision; all lab tests run offline.
- `graph/deterministic-extractor.ts` — rule-based, fully offline, fully
  deterministic implementation (topics from H2 sections, entities from
  list-item surfaces with slash-splitting and a kind lexicon, claims per
  block, slash-pair relationships with same-line evidence). The hand-grounded
  fixture graph is the curated gold standard; the extractor is the baseline.
- `graph/retrieval.ts` — `GraphIndex`: span/evidence lookup, claim search,
  salience ranking, span verification (the grounding invariant).

First supported external source remains the public article/Substack URL
(docs/overview-studio-architecture.md text-source extension).
