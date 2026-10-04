/**
 * WebFlix-Lab shared IR — public entry point (frozen by WFLX-W1).
 *
 * Consumers (Workers 2 and 3, TL integration) import types, zod guards and
 * deep validators from here. JSON Schemas live in ./schemas (regenerate
 * with `bun run contracts:emit`).
 */

export { CONTRACTS_VERSION } from './primitives';

// C-7 (v2 contract wave): the authoritative shared rate model.
export {
  ANCHOR_CONNECTOR_TOKENS,
  FACTUAL_TURN_PURPOSES,
  MIN_TURN_SECONDS,
  QUESTION_TAIL_TOKENS,
  TOPICAL_TISSUE_TOKENS,
  TURN_PLANNING_RATE_WPS,
} from './rate-model';

// C-5 (v2 contract wave): the per-unit content-keyed seeding hash.
export { unitContentHash } from './unit-content-hash';

export {
  ContractVersionSchema,
  EvidenceSpanSchema,
  FingerprintSchema,
  IdSchema,
  LanguageTagSchema,
  SemVerSchema,
  Sha256HexSchema,
  SourceAuthorizationSchema,
  SourceKindSchema,
  SourceProvenanceSchema,
  UtcTimestampSchema,
} from './primitives';
export type {
  ContractVersion,
  EvidenceSpan,
  Fingerprint,
  Id,
  LanguageTag,
  SemVer,
  Sha256Hex,
  SourceAuthorization,
  SourceKind,
  SourceProvenance,
  UtcTimestamp,
} from './primitives';

export { BlockKindSchema, SourceArtifactSchema, SourceBlockSchema } from './source-artifact';
export type { BlockKind, SourceArtifact, SourceBlock } from './source-artifact';

export { ClaimKindSchema, ClaimRecordSchema } from './claim';
export type { ClaimKind, ClaimRecord } from './claim';

export { EntityKindSchema, EntityMentionSchema, EntityRecordSchema } from './entity';
export type { EntityKind, EntityMention, EntityRecord } from './entity';

export { BlockRefSchema, TopicRecordSchema } from './topic';
export type { BlockRef, TopicRecord } from './topic';

export { RelationshipKindSchema, RelationshipRecordSchema } from './relationship';
export type { RelationshipKind, RelationshipRecord } from './relationship';

export { SemanticGraphSchema } from './semantic-graph';
export type { SemanticGraph } from './semantic-graph';

export {
  AUDIO_OVERVIEW_MODES,
  AUDIO_OVERVIEW_MODES as AudioOverviewModes,
  AudioOverviewModeSchema,
  AudienceLevelSchema,
  CoverageEntrySchema,
  CoverageMapSchema,
  NarrativeBeatSchema,
  OmittedClaimSchema,
  OverviewModeSchema,
  OverviewModalitySchema,
  OverviewPlanSchema,
  PlanGeneratorInfoSchema,
  PlanStyleSchema,
  VIDEO_OVERVIEW_MODES,
  VIDEO_OVERVIEW_MODES as VideoOverviewModes,
  VideoOverviewModeSchema,
} from './overview-plan';
export type {
  AudioOverviewMode,
  AudienceLevel,
  CoverageEntry,
  CoverageMap,
  NarrativeBeat,
  OmittedClaim,
  OverviewMode,
  OverviewModality,
  OverviewPlan,
  PlanGeneratorInfo,
  PlanStyle,
  VideoOverviewMode,
} from './overview-plan';

export {
  AudioTurnPurposeSchema,
  AudioTurnSchema,
  SpeakerRoleSchema,
  TurnStyleSchema,
} from './audio-turn';
export type {
  AudioTurn,
  AudioTurnPurpose,
  SpeakerRole,
  TurnStyle,
} from './audio-turn';

export {
  RenderingClassSchema,
  SceneMotionSchema,
  SceneTextItemSchema,
  SceneTransitionSchema,
  VideoSceneSchema,
  VisualTypeSchema,
} from './video-scene';
export type {
  RenderingClass,
  SceneMotion,
  SceneTextItem,
  SceneTransition,
  VideoScene,
  VisualType,
} from './video-scene';

export {
  ArtifactGeneratorInfoSchema,
  AudioMediaSpecSchema,
  GeneratedArtifactSchema,
  MediaContainerSchema,
  MediaInfoSchema,
  ProviderStageSchema,
  ProviderUsageSchema,
  QaIssueSchema,
  QaSeveritySchema,
  QaSummarySchema,
  VideoMediaSpecSchema,
} from './generated-artifact';
export type {
  ArtifactGeneratorInfo,
  AudioMediaSpec,
  GeneratedArtifact,
  MediaContainer,
  MediaInfo,
  ProviderStage,
  ProviderUsage,
  QaIssue,
  QaSeverity,
  QaSummary,
  VideoMediaSpec,
} from './generated-artifact';

export {
  EVIDENCE_LABELS,
  EvidenceKindSchema,
  ExperimentConfidenceSchema,
  ExperimentRecordSchema,
  ExperimentStatusSchema,
  ExperimentSurfaceSchema,
  hasEvidenceLabel,
} from './experiment-record';
export type {
  EvidenceKind,
  EvidenceLabel,
  ExperimentConfidence,
  ExperimentRecord,
  ExperimentStatus,
  ExperimentSurface,
} from './experiment-record';

export {
  countWords,
  sha256Hex,
  validateOverviewPlan,
  validateSemanticGraph,
  validateSourceArtifact,
} from './validation';
export type { DeepValidationResult, ValidationIssue } from './validation';

export { buildJsonSchemas, SCHEMA_BASE_ID, serializeSchema } from './emit-schemas';
export type { SchemaName } from './emit-schemas';
