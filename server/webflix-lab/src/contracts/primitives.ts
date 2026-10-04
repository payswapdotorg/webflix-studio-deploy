/**
 * WebFlix-Lab shared IR — primitive schemas shared by every frozen contract.
 *
 * Design decisions (WFLX-W1 contract freeze):
 * - zod v4 is the single source of truth: TypeScript types are inferred
 *   (`z.infer`), runtime guards are the schemas themselves (`safeParse`),
 *   and JSON Schemas are emitted deterministically (see emit-schemas.ts).
 * - All offsets are UTF-16 code units into the NFC-normalized source text
 *   (JavaScript string indices). The quote/block invariant
 *   `text.slice(start, end) === quote` is enforced by deep validators in
 *   validation.ts.
 * - Every record carries `recordType` (a discriminator for JSON interop) and
 *   `contractVersion` (the frozen contract bundle version, same major).
 */

import { z } from 'zod';

/**
 * Version of the frozen contract bundle. Bump per AGENTS.md drift controls.
 * v2.0.0 (v2 contract wave, ruling 2026-09-29): one breaking wave — C-5
 * per-unit content-keyed seeding (both surfaces), C-7 shared rate model,
 * C-9 styleBibleVersion emission, C-3 doc-only note. Same-plan outputs
 * change ONCE at this boundary and committed fingerprints regenerate in
 * the same change (corrected wave mechanics).
 */
export const CONTRACTS_VERSION = '2.0.0' as const;

const CONTRACTS_MAJOR = CONTRACTS_VERSION.split('.')[0] as string;

/** Stable identifier. Kebab-case, dotted or colon namespaced; never a secret. */
export const IdSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)
  .describe('Stable identifier, e.g. "claim-tool-catalog-1".');

export type Id = z.infer<typeof IdSchema>;

/** Semantic version of the contract bundle a record was built against. */
export const ContractVersionSchema = z
  .string()
  .regex(new RegExp(`^${CONTRACTS_MAJOR}\\.\\d+\\.\\d+$`))
  .describe(
    `Contract bundle version (major must match ${CONTRACTS_MAJOR}.x.x of the frozen contracts).`,
  );

export type ContractVersion = z.infer<typeof ContractVersionSchema>;

/** ISO-8601 UTC timestamp with mandatory seconds, Z-terminated. */
export const UtcTimestampSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/)
  .describe('ISO-8601 UTC timestamp, e.g. "2026-09-26T19:26:00Z".');

export type UtcTimestamp = z.infer<typeof UtcTimestampSchema>;

/** Lowercase hex SHA-256 digest. */
export const Sha256HexSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/)
  .describe('Lowercase hex SHA-256 digest.');

export type Sha256Hex = z.infer<typeof Sha256HexSchema>;

/** Plain semver string (used for tool versions, not contract versioning). */
export const SemVerSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+$/)
  .describe('Semantic version, e.g. "0.1.0".');

export type SemVer = z.infer<typeof SemVerSchema>;

/** BCP-47 language tag (loosely validated). */
export const LanguageTagSchema = z
  .string()
  .regex(/^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$/)
  .describe('BCP-47 language tag, e.g. "en" or "pt-BR".');

export type LanguageTag = z.infer<typeof LanguageTagSchema>;

/**
 * Content-identity fingerprint of a source. Two hashes on purpose:
 * `rawSha256` pins the exact ingested bytes (immutable provenance),
 * `contentSha256` pins the normalized text (the offsets' anchor).
 */
export const FingerprintSchema = z
  .strictObject({
    contentSha256: Sha256HexSchema.describe(
      'SHA-256 of the UTF-8 bytes of the normalized text.',
    ),
    rawSha256: Sha256HexSchema.describe(
      'SHA-256 of the raw input bytes as ingested, before normalization.',
    ),
    textLength: z
      .number()
      .int()
      .min(0)
      .describe('Length of the normalized text in UTF-16 code units.'),
  })
  .meta({ id: 'Fingerprint', title: 'Fingerprint' })
  .describe('Content-identity fingerprint of a source.');

export type Fingerprint = z.infer<typeof FingerprintSchema>;

/** Ingest path of a source. Mirrors the authorized text-source extension list in docs/overview-studio-architecture.md. */
export const SourceKindSchema = z
  .enum([
    'markdown-note',
    'plain-text',
    'pasted-text',
    'public-article',
    'substack',
    'rss',
    'pdf-text',
    'epub',
  ])
  .describe('Kind of ingest path that produced the source.');

export type SourceKind = z.infer<typeof SourceKindSchema>;

export const SourceAuthorizationSchema = z
  .enum(['public', 'operator-authorized', 'user-provided'])
  .describe('Authorization state for the ingest path used.');

export type SourceAuthorization = z.infer<typeof SourceAuthorizationSchema>;

/** Provenance of a source artifact. Never contains credentials or secrets. */
export const SourceProvenanceSchema = z
  .strictObject({
    kind: SourceKindSchema,
    label: z
      .string()
      .min(1)
      .max(300)
      .describe('Human-readable origin, e.g. a file name or site name.'),
    url: z
      .url()
      .optional()
      .describe('Canonical public URL when fetched from the public web. Omitted for local or pasted inputs.'),
    fetchedAt: UtcTimestampSchema.optional().describe('When the content was fetched (UTC).'),
    authorization: SourceAuthorizationSchema,
  })
  .meta({ id: 'SourceProvenance', title: 'SourceProvenance' })
  .describe('Provenance and authorization state of a source.');

export type SourceProvenance = z.infer<typeof SourceProvenanceSchema>;

/**
 * A span of evidence: an exact quote plus offsets into a SourceArtifact's
 * normalized text. Grounding invariant (deep-validated):
 * `source.text.slice(start, end) === quote`.
 */
export const EvidenceSpanSchema = z
  .strictObject({
    sourceId: IdSchema.describe('Id of the SourceArtifact this span indexes into.'),
    blockId: IdSchema.describe('Id of the SourceBlock containing the span.'),
    start: z
      .number()
      .int()
      .min(0)
      .describe('Inclusive start offset in UTF-16 code units into the source text.'),
    end: z.number().int().min(0).describe('Exclusive end offset in UTF-16 code units.'),
    quote: z
      .string()
      .min(1)
      .describe('Exact quoted substring; must equal source.text.slice(start, end).'),
  })
  .meta({ id: 'EvidenceSpan', title: 'EvidenceSpan' })
  .check((ctx) => {
    if (ctx.value.end <= ctx.value.start) {
      ctx.issues.push({
        code: 'custom',
        message: 'end must be greater than start',
        input: ctx.value.end,
        path: ['end'],
      });
    }
  })
  .describe('An exact evidence quote plus offsets into the source text.');

export type EvidenceSpan = z.infer<typeof EvidenceSpanSchema>;
