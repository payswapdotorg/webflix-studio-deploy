/**
 * WebFlix-Lab Operator Studio (WFLX-UI1 + WFLX-UI2) — the zero-build web client.
 *
 * Vanilla TypeScript in a module script: no bundler, no framework, no CDN,
 * no npm dependency. The server serves this file type-stripped at /app.js;
 * the root `tsc --noEmit` run typechecks it as-is (types are imported
 * TYPE-ONLY from the studio's HTTP contract in ../api/types.ts and erased
 * at serve time).
 *
 * DOM typing note: the ROOT tsc program deliberately carries NO "DOM" lib —
 * adding it would change `Response`/`BodyInit` resolution and break frozen
 * test files (verified against main). This client therefore declares the
 * exact, narrow DOM surface it uses as LOCAL interfaces below (no ambient
 * globals, zero collision with the frozen program) and reaches the real
 * objects through globalThis. Every line of client code is still fully
 * typechecked by the single root entrypoint.
 *
 * App states (work order §C): loading / error / empty / playing, plus the
 * honest provider state. NO dead controls: everything rendered does exactly
 * what it says. The interactive session surface (WFLX-UI2, surface D) renders
 * ONLY after a successful compile: Join -> boundary markers in the transcript
 * -> typed ask (voice capture UNRESOLVED, labeled verbatim) -> inserted
 * response turns highlighted -> session master vs baseline in the player ->
 * locality + grounding proofs. Fork semantics stay labeled at every step.
 */

import type {
  AudioOverviewMode,
  HealthResponse,
  OverviewResponse,
  SessionEstablishResponse,
  SessionInterveneResponse,
  SessionStateResponse,
  SourcesResponse,
  SourceDescriptor,
  TranscriptRow,
} from '../api/types';

// ---------------------------------------------------------------------------
// Gateway routing (TL environment patch, 2026-10-04): the operator console
// exposes ONE external port; the preview gateway routes to the studio's
// fixed port 4313 ONLY when the request carries the XTransformPort query.
// Every fetch/audio URL therefore appends it (harmless on direct localhost
// access — the server ignores unknown query parameters).
// ---------------------------------------------------------------------------

const GATEWAY_PORT_QUERY = 'XTransformPort=4313';

function withGatewayQuery(url: string): string {
  return url + (url.includes('?') ? '&' : '?') + GATEWAY_PORT_QUERY;
}

// ---------------------------------------------------------------------------
// Typed DOM façade (local, minimal, exact)
// ---------------------------------------------------------------------------

interface PointerEventLike {
  readonly clientX: number;
}

interface KeyboardEventLike {
  readonly key: string;
  preventDefault(): void;
}

interface ClassListLike {
  toggle(token: string, force?: boolean): boolean;
  add(...tokens: string[]): void;
  remove(...tokens: string[]): void;
  contains(token: string): boolean;
}

interface DomRectLike {
  readonly left: number;
  readonly width: number;
}

/**
 * The union of DOM element members this client uses (element creation is
 * string-tagged, so one structural interface keeps the façade small and
 * honest about what the code actually touches).
 */
interface DomElement {
  textContent: string | null;
  hidden: boolean;
  disabled: boolean;
  title: string;
  className: string;
  value: string;
  checked: boolean;
  type: string;
  name: string;
  dataset: Record<string, string>;
  classList: ClassListLike;
  style: { width: string };
  appendChild<T extends DomElement>(node: T): T;
  addEventListener(type: string, listener: (event: never) => void): void;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  getBoundingClientRect(): DomRectLike;
  scrollIntoView(options?: { block?: string }): void;
  querySelectorAll(selector: string): DomElement[];
  querySelector(selector: string): DomElement | null;
  // <audio>
  src: string;
  currentTime: number;
  paused: boolean;
  duration: number;
  load(): void;
  play(): Promise<void>;
  pause(): void;
}

interface DomDocument {
  createElement(tag: string): DomElement;
  getElementById(id: string): DomElement | null;
}

const doc: DomDocument = (globalThis as unknown as { document: DomDocument }).document;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function elementById(id: string): DomElement {
  const found = doc.getElementById(id);
  if (found === null) {
    throw new Error(`studio client: missing element #${id}`);
  }
  return found;
}

function setText(el: DomElement, value: string): void {
  el.textContent = value;
}

function show(el: DomElement, visible: boolean): void {
  el.hidden = !visible;
}

class StudioHttpError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'StudioHttpError';
  }
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(withGatewayQuery(url), init);
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof body === 'object' && body !== null && 'message' in body
        ? String((body as { message: unknown }).message)
        : `HTTP ${response.status}`;
    const code =
      typeof body === 'object' && body !== null && 'error' in body
        ? String((body as { error: unknown }).error)
        : 'http-error';
    throw new StudioHttpError(code, message, response.status);
  }
  return body as T;
}

function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const whole = Math.floor(seconds);
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function shortHash(value: string): string {
  return value.length > 14 ? `${value.slice(0, 14)}…` : value;
}

function formatBytes(bytes: number): string {
  if (bytes > 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Thousands-grouped integer milliseconds, e.g. "+21,940 ms". */
function formatMsDelta(ms: number): string {
  const grouped = Math.abs(ms).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${ms < 0 ? '−' : '+'}${grouped} ms`;
}

/** Start offset in seconds with one decimal, e.g. "83.4 s". */
function formatStartSec(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

// ---------------------------------------------------------------------------
// Client state
// ---------------------------------------------------------------------------

type Phase = 'empty' | 'loading' | 'ready' | 'error';

interface ClientState {
  sources: readonly SourceDescriptor[];
  sourceId: string | null;
  mode: AudioOverviewMode;
  durationSeconds: number;
  overview: OverviewResponse | null;
  phase: Phase;
}

/**
 * Interactive session state (WFLX-UI2). `latest` is the intervention whose
 * timeline + proofs are displayed; `activeMaster` picks which WAV the player
 * loads (session master vs baseline). Fork semantics: every intervention is
 * an independent fork from the baseline — nothing here is cumulative.
 */
interface InteractiveState {
  phase: 'idle' | 'joining' | 'joined';
  sessionId: string | null;
  overviewId: string | null;
  turnCount: number;
  validBoundaries: readonly number[];
  joins: number;
  selectedBoundary: number | null;
  interventions: SessionInterveneResponse[];
  latest: SessionInterveneResponse | null;
  activeMaster: 'baseline' | 'session';
  asking: boolean;
}

const DURATION_CHOICES: readonly number[] = [120, 180, 300, 420, 600];

const SCRIPTED_QUESTIONS: readonly string[] = [
  'Can you say more about the open-source media projects and local model runtimes?',
  'What does the note say about its purpose?',
];

const state: ClientState = {
  sources: [],
  sourceId: null,
  mode: 'deep-dive',
  durationSeconds: 300,
  overview: null,
  phase: 'empty',
};

const interactive: InteractiveState = {
  phase: 'idle',
  sessionId: null,
  overviewId: null,
  turnCount: 0,
  validBoundaries: [],
  joins: 0,
  selectedBoundary: null,
  interventions: [],
  latest: null,
  activeMaster: 'baseline',
  asking: false,
};

// ---------------------------------------------------------------------------
// Wired elements
// ---------------------------------------------------------------------------

const providerChipText = elementById('provider-chip-text');
const providerChip = elementById('provider-chip');
const sourceList = elementById('source-list');
const sourcesEmpty = elementById('sources-empty');
const modeSelect = elementById('mode-select');
const durationSelect = elementById('duration-select');
const compileButton = elementById('compile-button');
const overviewEmpty = elementById('overview-empty');
const overviewLoading = elementById('overview-loading');
const overviewError = elementById('overview-error');
const overviewReady = elementById('overview-ready');
const errorTitle = elementById('error-title');
const errorMessage = elementById('error-message');
const errorHint = elementById('error-hint');
const audio = elementById('player');
const playButton = elementById('play-button');
const playIcon = elementById('play-icon');
const progressTrack = elementById('progress-track');
const progressFill = elementById('progress-fill');
const timeCurrent = elementById('time-current');
const timeTotal = elementById('time-total');
const nowPlaying = elementById('now-playing');
const playerError = elementById('player-error');
const playerMode = elementById('player-mode');
const playerProvider = elementById('player-provider');
const transcriptList = elementById('transcript-list');
const metadataList = elementById('metadata-list');
const provenanceList = elementById('provenance-list');

// --- Interactive session surface (WFLX-UI2) ---
const ixSection = elementById('ix-section');
const ixEntry = elementById('ix-entry');
const ixJoinButton = elementById('ix-join-button');
const ixJoining = elementById('ix-joining');
const ixJoined = elementById('ix-joined');
const transcriptIxNote = elementById('transcript-ix-note');
const ixSessionKv = elementById('ix-session-kv');
const ixAskCard = elementById('ix-ask-card');
const ixNoBoundaries = elementById('ix-no-boundaries');
const ixBoundaryStatus = elementById('ix-boundary-status');
const ixAskInput = elementById('ix-ask-input');
const ixChips = elementById('ix-chips');
const ixAskButton = elementById('ix-ask-button');
const ixAskLoading = elementById('ix-ask-loading');
const ixAskError = elementById('ix-ask-error');
const ixRejoinButton = elementById('ix-rejoin-button');
const ixResults = elementById('ix-results');
const ixResultsWide = elementById('ix-results-wide');
const ixMasterSession = elementById('ix-master-session');
const ixMasterBaseline = elementById('ix-master-baseline');
const ixMasterKv = elementById('ix-master-kv');
const ixLocalitySummary = elementById('ix-locality-summary');
const ixLocalityBody = elementById('ix-locality-body');
const ixLocalityInvariant = elementById('ix-locality-invariant');
const ixGroundingSummary = elementById('ix-grounding-summary');
const ixGroundingClaims = elementById('ix-grounding-claims');
const ixGroundingKv = elementById('ix-grounding-kv');
const ixProvenanceKv = elementById('ix-provenance-kv');
const ixHistoryList = elementById('ix-history-list');
const ixHistoryEmpty = elementById('ix-history-empty');

// ---------------------------------------------------------------------------
// Phase management (the four app states)
// ---------------------------------------------------------------------------

function setPhase(phase: Phase): void {
  state.phase = phase;
  show(overviewEmpty, phase === 'empty');
  show(overviewLoading, phase === 'loading');
  show(overviewError, phase === 'error');
  show(overviewReady, phase === 'ready');
  compileButton.disabled = phase === 'loading';
  setText(compileButton, phase === 'loading' ? 'Compiling…' : 'Compile Overview');
}

function showError(title: string, message: string, hint: string): void {
  setText(errorTitle, title);
  setText(errorMessage, message);
  setText(errorHint, hint);
  setPhase('error');
}

// ---------------------------------------------------------------------------
// Boot: health + sources
// ---------------------------------------------------------------------------

async function loadHealth(): Promise<void> {
  try {
    const health = await fetchJson<HealthResponse>('/api/health');
    const gated = health.provider.gated.map((g) => `${g.id.split('-')[0]}: ${g.state}`);
    setText(
      providerChipText,
      `${health.provider.active} · offline (pinned) · live ${gated.join(' / ')}`,
    );
    providerChip.title =
      `${health.provider.note}\n` +
      health.provider.gated
        .map((g) => `${g.id} — ${g.state} (activation: ${g.activation})`)
        .join('\n');
  } catch (error) {
    setText(providerChipText, 'health unavailable');
    providerChip.classList.add('provider-chip-error');
    providerChip.title = error instanceof Error ? error.message : String(error);
  }
}

async function loadSources(): Promise<void> {
  let body: SourcesResponse;
  try {
    body = await fetchJson<SourcesResponse>('/api/sources');
  } catch (error) {
    show(sourcesEmpty, true);
    setText(
      sourcesEmpty,
      `Failed to enumerate sources: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }
  state.sources = body.sources;
  renderSources();
}

function renderSources(): void {
  setText(sourceList, '');
  if (state.sources.length === 0) {
    show(sourcesEmpty, true);
    return;
  }
  for (const source of state.sources) {
    const li = doc.createElement('li');
    li.className = 'source-item';

    const label = doc.createElement('label');
    const radio = doc.createElement('input');
    radio.type = 'radio';
    radio.name = 'source';
    radio.value = source.id;
    radio.checked = state.sourceId === source.id;
    radio.addEventListener('change', () => {
      selectSource(source.id);
    });
    label.appendChild(radio);

    const title = doc.createElement('span');
    title.className = 'source-title';
    setText(title, source.title);
    label.appendChild(title);

    const path = doc.createElement('span');
    path.className = 'source-path mono';
    setText(path, source.label);
    label.appendChild(path);

    const fp = doc.createElement('span');
    fp.className = 'source-fp mono';
    const fpValue = doc.createElement('span');
    fpValue.className = 'fp-value';
    setText(fpValue, `sha256 ${shortHash(source.fingerprint.contentSha256)}`);
    fp.textContent = 'content ';
    fp.appendChild(fpValue);
    fp.title =
      `contentSha256: ${source.fingerprint.contentSha256}\n` +
      `rawSha256: ${source.fingerprint.rawSha256}\n` +
      `textLength: ${source.fingerprint.textLength}`;
    label.appendChild(fp);

    const stats = doc.createElement('span');
    stats.className = 'source-stats';
    setText(
      stats,
      `${source.wordCount} words · ${source.blockCount} blocks · ${source.language} · ${source.adapter}`,
    );
    label.appendChild(stats);

    li.appendChild(label);
    sourceList.appendChild(li);
  }
  if (state.sourceId === null && state.sources.length > 0) {
    const first = state.sources[0];
    if (first !== undefined) selectSource(first.id);
  }
}

function selectSource(sourceId: string): void {
  state.sourceId = sourceId;
  for (const item of sourceList.querySelectorAll('input[type="radio"]')) {
    item.checked = item.value === sourceId;
  }
  renderModeControls();
}

// ---------------------------------------------------------------------------
// Mode + duration controls (the Director's existing surface only)
// ---------------------------------------------------------------------------

function renderModeControls(): void {
  const source = state.sources.find((candidate) => candidate.id === state.sourceId);
  const modes = source?.modes ?? [];
  setText(modeSelect, '');
  for (const info of modes) {
    const option = doc.createElement('option');
    option.value = info.mode;
    option.textContent = `${info.mode} (${info.canonicalDurationSeconds}s${info.default ? ' · default' : ''})`;
    modeSelect.appendChild(option);
  }
  modeSelect.value = state.mode;
  renderDurationChoices();
}

function renderDurationChoices(): void {
  const source = state.sources.find((candidate) => candidate.id === state.sourceId);
  const canonical = source?.modes.find((m) => m.mode === state.mode)?.canonicalDurationSeconds;
  setText(durationSelect, '');
  const choices = new Set<number>(DURATION_CHOICES);
  if (canonical !== undefined) choices.add(canonical);
  for (const seconds of [...choices].sort((a, b) => a - b)) {
    const option = doc.createElement('option');
    option.value = String(seconds);
    option.textContent = `${seconds}s`;
    durationSelect.appendChild(option);
  }
  state.durationSeconds = canonical ?? state.durationSeconds;
  durationSelect.value = String(state.durationSeconds);
}

modeSelect.addEventListener('change', () => {
  state.mode = modeSelect.value as AudioOverviewMode;
  renderDurationChoices();
});

durationSelect.addEventListener('change', () => {
  const parsed = Number.parseInt(durationSelect.value, 10);
  if (Number.isFinite(parsed)) state.durationSeconds = parsed;
});

// ---------------------------------------------------------------------------
// Compile flow
// ---------------------------------------------------------------------------

compileButton.addEventListener('click', () => {
  void compileOverview();
});

async function compileOverview(): Promise<void> {
  if (state.sourceId === null) {
    showError('No source selected', 'Pick a source before compiling.', 'Choose a source on the left.');
    return;
  }
  stopPlayback();
  resetInteractive();
  setPhase('loading');
  try {
    const overview = await fetchJson<OverviewResponse>('/api/overview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sourceId: state.sourceId,
        mode: state.mode,
        durationSeconds: state.durationSeconds,
      }),
    });
    state.overview = overview;
    renderOverview(overview);
  } catch (error) {
    if (error instanceof StudioHttpError) {
      showError(
        `Compile failed — ${error.code}`,
        error.message,
        error.status >= 500
          ? 'The real pipeline threw; read the message, then retry or adjust mode/duration.'
          : 'Fix the request inputs and compile again.',
      );
    } else {
      showError(
        'Compile failed — network',
        error instanceof Error ? error.message : String(error),
        'Check the studio server is running (bun run studio), then retry.',
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Overview rendering (player + transcript + metadata + provenance)
// ---------------------------------------------------------------------------

function renderOverview(overview: OverviewResponse): void {
  setPhase('ready');

  audio.src = withGatewayQuery(overview.audioUrl);
  audio.load();
  show(playerError, false);
  setText(playerError, '');

  setText(playerMode, `${overview.plan.mode} · ${overview.plan.targetDurationSeconds}s target`);
  setText(playerProvider, overview.provider);

  renderTranscript();
  renderMetadata(overview);
  renderProvenance(overview);
  renderIxEntry();

  updateProgress(0);
  setText(timeTotal, formatClock(overview.timing.totalDurationMs / 1000));
  setText(nowPlaying, 'ready');
  setText(playIcon, '▶');
  playButton.setAttribute('aria-label', 'Play overview');
}

// ---------------------------------------------------------------------------
// Transcript rendering (baseline turns; session timeline + boundary markers
// once an interactive session is joined — WFLX-UI2)
// ---------------------------------------------------------------------------

/** The renderable row shape for whichever timeline is active. */
interface TimelineRow {
  readonly turnId: string;
  readonly speakerName: string;
  readonly purpose: string;
  readonly text: string;
  readonly startMs: number;
  readonly inserted: boolean;
  readonly baselineIndex: number | null;
}

/** True when the player is loaded with a session master + its timeline. */
function sessionTimelineActive(): boolean {
  return (
    interactive.phase === 'joined' &&
    interactive.activeMaster === 'session' &&
    interactive.latest !== null
  );
}

function activeTimelineRows(): readonly TimelineRow[] {
  const overview = state.overview;
  if (overview === null) return [];
  const latest = interactive.latest;
  if (sessionTimelineActive() && latest !== null) {
    return latest.timeline.map((row) => ({
      turnId: row.turnId,
      speakerName: row.speakerName,
      purpose: row.purpose,
      text: row.text,
      startMs: row.startMs,
      inserted: row.inserted,
      baselineIndex: row.baselineIndex,
    }));
  }
  return overview.transcript.map((row: TranscriptRow) => ({
    turnId: row.turnId,
    speakerName: row.speakerName,
    purpose: row.purpose,
    text: row.text,
    startMs: row.startMs,
    inserted: false,
    baselineIndex: row.index,
  }));
}

function renderTranscript(): void {
  setText(transcriptList, '');
  const rows = activeTimelineRows();
  const joined = interactive.phase === 'joined';
  for (const row of rows) {
    const li = doc.createElement('li');
    li.className = 'turn';
    if (row.inserted) li.classList.add('inserted');
    li.dataset['turnId'] = row.turnId;

    const speaker = doc.createElement('div');
    speaker.className = 'turn-speaker';
    const name = doc.createElement('span');
    name.className = 'turn-name';
    setText(name, row.speakerName);
    const purpose = doc.createElement('span');
    purpose.className = 'turn-purpose';
    setText(purpose, row.inserted ? `${row.purpose} · inserted` : row.purpose);
    const time = doc.createElement('span');
    time.className = 'turn-time';
    setText(time, formatClock(row.startMs / 1000));
    speaker.appendChild(name);
    speaker.appendChild(purpose);
    speaker.appendChild(time);

    const body = doc.createElement('div');
    body.className = 'turn-text';
    setText(body, row.text);

    li.appendChild(speaker);
    li.appendChild(body);
    li.addEventListener('click', () => {
      seekToMs(row.startMs);
    });
    transcriptList.appendChild(li);

    // Boundary marker after every valid interior boundary (joined state only).
    if (
      joined &&
      row.baselineIndex !== null &&
      interactive.validBoundaries.includes(row.baselineIndex)
    ) {
      transcriptList.appendChild(boundaryMarker(row.baselineIndex, row.turnId));
    }
  }
}

/** A ⌁ marker: the intervention point after baseline turn `index`. */
function boundaryMarker(index: number, afterTurnId: string): DomElement {
  const li = doc.createElement('li');
  li.className = 'boundary-marker';
  li.dataset['boundary'] = String(index);
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'boundary-btn';
  const selected = interactive.selectedBoundary === index;
  if (selected) li.classList.add('selected');
  const forks = interactive.interventions.filter(
    (record) => record.afterTurnIndex === index,
  ).length;
  setText(
    button,
    selected
      ? `⑂ boundary ${index} · after ${afterTurnId} — selected`
      : `⑂ boundary ${index} · ask after ${afterTurnId}${forks > 0 ? ` · ${forks} fork${forks > 1 ? 's' : ''} here` : ''}`,
  );
  button.setAttribute(
    'aria-label',
    `Select intervention boundary ${index}, after baseline turn ${afterTurnId}`,
  );
  button.addEventListener('click', () => {
    selectBoundary(index);
  });
  li.appendChild(button);
  return li;
}

function selectBoundary(index: number): void {
  interactive.selectedBoundary = index;
  renderTranscript();
  renderBoundaryStatus();
}

function kvRow(
  list: DomElement,
  term: string,
  value: string,
  opts: { mono?: boolean; dim?: boolean; title?: string } = {},
): void {
  const dt = doc.createElement('dt');
  setText(dt, term);
  const dd = doc.createElement('dd');
  setText(dd, value);
  if (opts.mono === true) dd.className = 'hash';
  if (opts.dim === true) dd.className = 'dim';
  if (opts.title !== undefined) dd.title = opts.title;
  list.appendChild(dt);
  list.appendChild(dd);
}

function renderMetadata(overview: OverviewResponse): void {
  const plan = overview.plan;
  setText(metadataList, '');
  kvRow(metadataList, 'Mode', plan.mode);
  kvRow(metadataList, 'Language', plan.language);
  kvRow(metadataList, 'Audience', plan.audience);
  kvRow(metadataList, 'Target duration', `${plan.targetDurationSeconds} s`);
  kvRow(metadataList, 'Actual duration', `${(overview.timing.totalDurationMs / 1000).toFixed(1)} s`);
  kvRow(metadataList, 'Turns', String(plan.turnCount));
  kvRow(metadataList, 'Speakers', String(plan.speakerCount));
  kvRow(metadataList, 'Beats', String(plan.beatCount));
  kvRow(metadataList, 'Claims covered', `${plan.coveredClaimCount} covered · ${plan.omittedClaimCount} omitted`);
  kvRow(metadataList, 'Plan id', plan.planId, { mono: true, dim: true, title: plan.planId });
  kvRow(metadataList, 'Plan hash', shortHash(plan.planHash), { mono: true, title: plan.planHash });
  kvRow(metadataList, 'Objective', plan.objective, { dim: true });
}

function renderProvenance(overview: OverviewResponse): void {
  const artifact = overview.artifact;
  setText(provenanceList, '');
  kvRow(provenanceList, 'Artifact id', overview.artifactId, { mono: true, title: overview.artifactId });
  kvRow(provenanceList, 'Evidence class', overview.evidenceClass, { dim: true });
  // WFLX-UI3 audit fill: the GeneratedArtifact sourceIds convention (lineage).
  kvRow(provenanceList, 'Source ids', artifact.sourceIds.join(', '), {
    mono: true,
    dim: true,
    title: artifact.sourceIds.join(', '),
  });
  kvRow(provenanceList, 'Media sha256', shortHash(artifact.media.sha256), {
    mono: true,
    title: artifact.media.sha256,
  });
  kvRow(provenanceList, 'Media size', formatBytes(artifact.media.sizeBytes));
  const mediaAudio = artifact.media.audio;
  kvRow(
    provenanceList,
    'Audio',
    mediaAudio === undefined
      ? '—'
      : `${mediaAudio.sampleRateHz} Hz · ${mediaAudio.channels} ch · ${mediaAudio.codec}`,
  );
  kvRow(provenanceList, 'Speech provider', overview.provider, { dim: true });
  kvRow(provenanceList, 'Mastering', `${overview.mastering} (deterministic)`, { dim: true });
  kvRow(provenanceList, 'Plan id', artifact.planId, { mono: true, dim: true, title: artifact.planId });
  kvRow(provenanceList, 'Created at', artifact.createdAt, { dim: true });
  kvRow(provenanceList, 'Generator', `${artifact.generator.name} · seed ${artifact.generator.seed}`, {
    mono: true,
    dim: true,
    title: artifact.generator.seed,
  });
  kvRow(
    provenanceList,
    'Reproducible',
    artifact.generator.reproducible ? 'yes (byte-identical recompile)' : 'no',
    { dim: true },
  );
  const qa = artifact.qa;
  kvRow(
    provenanceList,
    'QA',
    qa === undefined
      ? 'not evaluated'
      : `${qa.status}${qa.issues.length > 0 ? ` · ${qa.issues.length} issue(s)` : ''}`,
    { dim: true },
  );
  for (const usage of artifact.providers) {
    kvRow(provenanceList, `Stage · ${usage.stage}`, usage.provider, { dim: true });
  }
  kvRow(provenanceList, 'Notes', artifact.notes ?? '—', { dim: true, title: artifact.notes ?? '' });
}

// ---------------------------------------------------------------------------
// Player wiring (play/pause, seek, progress, current-turn highlight)
// ---------------------------------------------------------------------------

playButton.addEventListener('click', () => {
  if (audio.paused) {
    audio.play().catch((error: unknown) => {
      show(playerError, true);
      setText(
        playerError,
        `Playback failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  } else {
    audio.pause();
  }
});

audio.addEventListener('play', () => {
  setText(playIcon, '❚❚');
  playButton.setAttribute('aria-label', 'Pause overview');
  // A successful play clears any earlier playback error (stale-error nit).
  show(playerError, false);
});

audio.addEventListener('pause', () => {
  setText(playIcon, '▶');
  playButton.setAttribute('aria-label', 'Play overview');
});

audio.addEventListener('ended', () => {
  setText(playIcon, '▶');
  setText(nowPlaying, 'ended');
});

audio.addEventListener('error', () => {
  show(playerError, true);
  setText(
    playerError,
    'Playback failed: the audio element could not load the master WAV. Re-compile, then reload if it persists.',
  );
});

audio.addEventListener('timeupdate', () => {
  updateProgress(audio.currentTime);
});

function totalSeconds(): number {
  if (sessionTimelineActive()) {
    return (interactive.latest?.sessionMaster.totalDurationMs ?? 0) / 1000;
  }
  const total = state.overview?.timing.totalDurationMs;
  return total === undefined ? 0 : total / 1000;
}

function updateProgress(currentSeconds: number): void {
  const total = totalSeconds();
  const fraction = total > 0 ? Math.min(1, currentSeconds / total) : 0;
  progressFill.style.width = `${(fraction * 100).toFixed(2)}%`;
  progressTrack.setAttribute('aria-valuenow', String(Math.round(fraction * 100)));
  progressTrack.setAttribute('aria-valuetext', formatClock(currentSeconds));
  setText(timeCurrent, formatClock(currentSeconds));
  highlightCurrentTurn(currentSeconds * 1000);
}

function seekToMs(ms: number): void {
  const total = totalSeconds();
  const clamped = Math.max(0, Math.min(total > 0 ? total - 0.01 : 0, ms / 1000));
  audio.currentTime = clamped;
  updateProgress(clamped);
  if (audio.paused) {
    audio.play().catch((error: unknown) => {
      show(playerError, true);
      setText(
        playerError,
        `Playback failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }
}

progressTrack.addEventListener('pointerdown', (event: PointerEventLike) => {
  const rect = progressTrack.getBoundingClientRect();
  const fraction = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  seekToMs(fraction * totalSeconds() * 1000);
});

progressTrack.addEventListener('keydown', (event: KeyboardEventLike) => {
  const step = event.key === 'ArrowLeft' ? -5 : event.key === 'ArrowRight' ? 5 : 0;
  if (step !== 0) {
    event.preventDefault();
    seekToMs((audio.currentTime + step) * 1000);
  } else if (event.key === 'Home') {
    event.preventDefault();
    seekToMs(0);
  } else if (event.key === 'End') {
    event.preventDefault();
    seekToMs((totalSeconds() - 0.05) * 1000);
  }
});

function highlightCurrentTurn(ms: number): void {
  const rows = activeTimelineRows();
  if (rows.length === 0) return;
  let current: TimelineRow | null = null;
  for (const row of rows) {
    if (row.startMs <= ms) current = row;
    else break;
  }
  for (const li of transcriptList.querySelectorAll('li.turn')) {
    li.classList.toggle('current', current !== null && li.dataset['turnId'] === current.turnId);
  }
  if (current !== null) {
    const li = transcriptList.querySelector(`li.turn[data-turn-id="${current.turnId}"]`);
    li?.scrollIntoView({ block: 'nearest' });
    setText(
      nowPlaying,
      `${current.speakerName} · ${current.purpose}${current.inserted ? ' · inserted' : ''}`,
    );
  } else {
    setText(nowPlaying, 'ready');
  }
}

function stopPlayback(): void {
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
}

// ---------------------------------------------------------------------------
// Interactive session surface (WFLX-UI2, surface D) — join, ask, proofs
// ---------------------------------------------------------------------------

/** Reset every interactive client state (on compile / re-compile). */
function resetInteractive(): void {
  interactive.phase = 'idle';
  interactive.sessionId = null;
  interactive.overviewId = null;
  interactive.turnCount = 0;
  interactive.validBoundaries = [];
  interactive.joins = 0;
  interactive.selectedBoundary = null;
  interactive.interventions = [];
  interactive.latest = null;
  interactive.activeMaster = 'baseline';
  interactive.asking = false;
  show(ixSection, false);
  show(ixEntry, false);
  show(ixJoining, false);
  show(ixJoined, false);
  show(transcriptIxNote, false);
}

/** After a successful compile: show the join entry (fork semantics labeled). */
function renderIxEntry(): void {
  show(ixSection, true);
  show(ixJoining, false);
  show(ixJoined, false);
  show(ixEntry, true);
  ixJoinButton.disabled = false;
}

ixJoinButton.addEventListener('click', () => {
  void joinSession();
});

async function joinSession(): Promise<void> {
  const overview = state.overview;
  if (overview === null) return;
  show(ixEntry, false);
  show(ixJoining, true);
  ixJoinButton.disabled = true;
  try {
    const established = await fetchJson<SessionEstablishResponse>('/api/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ overviewId: overview.artifactId }),
    });
    interactive.phase = 'joined';
    interactive.sessionId = established.sessionId;
    interactive.overviewId = established.overviewId;
    interactive.turnCount = established.turnCount;
    interactive.validBoundaries = established.validBoundaries;
    interactive.joins = established.joins;
    interactive.selectedBoundary = null;
    interactive.interventions = [];
    interactive.latest = null;
    interactive.activeMaster = 'baseline';
    interactive.asking = false;
    show(ixJoining, false);
    show(ixJoined, true);
    show(transcriptIxNote, true);
    renderChips();
    renderSessionCard();
    renderAskSurface();
    renderBoundaryStatus();
    renderHistory();
    hideAskError();
    renderTranscript();
    // A re-join on an already-intervened session (e.g. after a page reload of
    // the same overview) restores the fork history from the session state.
    if (established.joins > 1) {
      await syncSessionState();
    }
  } catch (error) {
    show(ixJoining, false);
    show(ixEntry, true);
    ixJoinButton.disabled = false;
    setText(
      ixEntry,
      `Join failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Fetch GET /api/session/:id and restore history (re-join path). */
async function syncSessionState(): Promise<void> {
  const sessionId = interactive.sessionId;
  if (sessionId === null) return;
  try {
    const sessionState = await fetchJson<SessionStateResponse>(`/api/session/${sessionId}`);
    interactive.joins = sessionState.joins;
    if (sessionState.interventions.length > 0 && interactive.interventions.length === 0) {
      // Full intervention records are not carried by the state route; the
      // panels render from live asks. History rows below still summarize the
      // server-side records honestly.
      renderSessionCard();
    }
  } catch {
    // The state route is best-effort for the re-join path; ask errors surface
    // typed bodies on their own.
  }
}

function renderChips(): void {
  setText(ixChips, '');
  const chipNote = doc.createElement('span');
  chipNote.className = 'ix-chips-label';
  setText(chipNote, 'scripted (EXP-L-03) — not AI-suggested:');
  ixChips.appendChild(chipNote);
  for (const question of SCRIPTED_QUESTIONS) {
    const chip = doc.createElement('button');
    chip.type = 'button';
    chip.className = 'ix-chip';
    setText(chip, question);
    chip.title = 'Fill the ask box with this scripted question (one click).';
    chip.addEventListener('click', () => {
      ixAskInput.value = question;
      ixAskInput.title = question;
      hideAskError();
    });
    ixChips.appendChild(chip);
  }
}

function renderSessionCard(): void {
  setText(ixSessionKv, '');
  const boundaries =
    interactive.validBoundaries.length > 0
      ? `${interactive.validBoundaries.length} (0..${interactive.validBoundaries[interactive.validBoundaries.length - 1]})`
      : 'none (no interior boundaries)';
  kvRow(ixSessionKv, 'Session id', interactive.sessionId ?? '—', { mono: true });
  kvRow(ixSessionKv, 'Baseline overview', interactive.overviewId ?? '—', {
    mono: true,
    title: interactive.overviewId ?? '',
  });
  kvRow(ixSessionKv, 'Baseline turns', String(interactive.turnCount));
  kvRow(ixSessionKv, 'Valid boundaries', boundaries, { dim: true });
  kvRow(ixSessionKv, 'Joins', String(interactive.joins), { dim: true });
  kvRow(ixSessionKv, 'Registry', 'in-memory — restart resets', { dim: true });
}

/** The ask card renders only when the baseline HAS interior boundaries. */
function renderAskSurface(): void {
  const hasBoundaries = interactive.validBoundaries.length > 0;
  show(ixAskCard, hasBoundaries);
  show(ixNoBoundaries, !hasBoundaries);
}

function renderBoundaryStatus(): void {
  if (interactive.selectedBoundary === null) {
    setText(
      ixBoundaryStatus,
      `No boundary selected — click a ⑂ marker in the transcript (panel 3) to choose where the listener joins.`,
    );
    ixBoundaryStatus.classList.remove('armed');
    return;
  }
  const boundary = interactive.selectedBoundary;
  const forkCount = interactive.interventions.filter(
    (record) => record.afterTurnIndex === boundary,
  ).length;
  setText(
    ixBoundaryStatus,
    `boundary ${boundary} armed — the listener joins after baseline turn ${boundary} ` +
      `(${boundary + 1} of ${interactive.turnCount})${forkCount > 0 ? ` · ${forkCount} fork${forkCount > 1 ? 's' : ''} already recorded here` : ''}`,
  );
  ixBoundaryStatus.classList.add('armed');
}

function showAskError(message: string, offerRejoin: boolean): void {
  show(ixAskError, true);
  setText(ixAskError, message);
  show(ixRejoinButton, offerRejoin);
}

function hideAskError(): void {
  show(ixAskError, false);
  setText(ixAskError, '');
  show(ixRejoinButton, false);
}

ixAskButton.addEventListener('click', () => {
  void ask();
});

ixAskInput.addEventListener('keydown', (event: KeyboardEventLike) => {
  if (event.key === 'Enter') {
    void ask();
  }
});

ixRejoinButton.addEventListener('click', () => {
  hideAskError();
  void joinSession();
});

async function ask(): Promise<void> {
  if (interactive.asking) return;
  if (interactive.sessionId === null) return;
  hideAskError();
  if (interactive.selectedBoundary === null) {
    showAskError('Pick a boundary first: click a ⑂ marker in the transcript (panel 3).', false);
    return;
  }
  const listenerText = ixAskInput.value.trim();
  if (listenerText.length === 0) {
    showAskError('Type a listener question first (typed stand-in — voice capture UNRESOLVED).', false);
    return;
  }

  interactive.asking = true;
  ixAskButton.disabled = true;
  ixAskInput.disabled = true;
  show(ixAskLoading, true);
  try {
    const response = await fetchJson<SessionInterveneResponse>(
      `/api/session/${interactive.sessionId}/intervene`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          afterTurnIndex: interactive.selectedBoundary,
          listenerText,
        }),
      },
    );
    interactive.interventions.push(response);
    interactive.latest = response;
    ixAskInput.value = '';
    // The session master becomes the player's load, the timeline re-renders
    // with the inserted turns, and the proofs render (all below).
    setActiveMaster('session');
    renderIxResults();
    renderBoundaryStatus();
    renderHistory();
    renderTranscript();
    ixResultsWide.scrollIntoView({ block: 'start' });
  } catch (error) {
    if (error instanceof StudioHttpError) {
      const offerRejoin = error.code === 'unknown-session' || error.code === 'unknown-overview';
      showAskError(
        `Ask failed — ${error.code}: ${error.message}`,
        offerRejoin,
      );
    } else {
      showAskError(
        `Ask failed — network: ${error instanceof Error ? error.message : String(error)}`,
        false,
      );
    }
  } finally {
    interactive.asking = false;
    ixAskButton.disabled = false;
    ixAskInput.disabled = false;
    show(ixAskLoading, false);
  }
}

// --- Masters: session master vs baseline in the same player ---------------

ixMasterSession.addEventListener('click', () => {
  setActiveMaster('session');
});

ixMasterBaseline.addEventListener('click', () => {
  setActiveMaster('baseline');
});

function setActiveMaster(which: 'baseline' | 'session'): void {
  const overview = state.overview;
  const latest = interactive.latest;
  if (overview === null) return;
  if (which === 'session' && latest === null) return; // nothing to load yet
  interactive.activeMaster = which;
  if (which === 'session' && latest !== null) {
    audio.src = withGatewayQuery(latest.sessionMaster.audioUrl);
    setText(playerMode, `session master · fork ${latest.interventionSeq}`);
    setText(nowPlaying, 'session master ready');
  } else {
    audio.src = withGatewayQuery(overview.audioUrl);
    setText(playerMode, `${overview.plan.mode} · ${overview.plan.targetDurationSeconds}s target`);
    setText(nowPlaying, 'baseline ready');
  }
  audio.load();
  setText(timeTotal, formatClock(totalSeconds()));
  updateProgress(0);
  renderMasterCard();
  renderTranscript();
}

function renderMasterCard(): void {
  setText(ixMasterKv, '');
  const latest = interactive.latest;
  const overview = state.overview;
  if (latest === null || overview === null) return;
  const sessionActive = interactive.activeMaster === 'session';
  ixMasterSession.setAttribute('aria-pressed', sessionActive ? 'true' : 'false');
  ixMasterBaseline.setAttribute('aria-pressed', sessionActive ? 'false' : 'true');
  ixMasterSession.classList.toggle('active', sessionActive);
  ixMasterBaseline.classList.toggle('active', !sessionActive);
  kvRow(ixMasterKv, 'Playing', sessionActive ? 'session master' : 'baseline master', {
    dim: true,
  });
  kvRow(ixMasterKv, 'Session master', latest.sessionMaster.artifactId, {
    mono: true,
    title: latest.sessionMaster.artifactId,
  });
  kvRow(ixMasterKv, 'Session sha256', shortHash(latest.sessionMaster.sha256), {
    mono: true,
    title: latest.sessionMaster.sha256,
  });
  kvRow(
    ixMasterKv,
    'Session size',
    `${formatBytes(latest.sessionMaster.sizeBytes)} · ${(latest.sessionMaster.totalDurationMs / 1000).toFixed(1)} s · ${latest.sessionMaster.turnCount} turns`,
    { dim: true },
  );
  kvRow(ixMasterKv, 'Baseline master', overview.artifactId, {
    mono: true,
    dim: true,
    title: overview.artifactId,
  });
  kvRow(
    ixMasterKv,
    'Baseline size',
    `${(latest.sessionMaster.baselineTotalDurationMs / 1000).toFixed(1)} s · ${overview.plan.turnCount} turns`,
    { dim: true },
  );
}

// --- Results panels: locality, grounding, provenance -----------------------

function renderIxResults(): void {
  const latest = interactive.latest;
  if (latest === null) {
    show(ixResults, false);
    show(ixResultsWide, false);
    return;
  }
  show(ixResults, true);
  show(ixResultsWide, true);
  renderMasterCard();
  renderGrounding(latest);
  renderLocality(latest);
  renderProvenanceIx(latest);
}

function renderLocality(record: SessionInterveneResponse): void {
  const locality = record.locality;
  const identical = locality.rows.filter((row) => row.wavSha256Equal).length;
  setText(
    ixLocalitySummary,
    `byte identity ${identical}/${locality.rows.length} original turns · ` +
      `machinery verdict ${locality.passed ? 'PASSED' : 'FAILED'} · original order ${locality.originalOrderPreserved ? 'preserved' : 'BROKEN'}`,
  );
  ixLocalitySummary.classList.toggle('ok', locality.passed);
  ixLocalitySummary.classList.toggle('bad', !locality.passed);

  setText(ixLocalityBody, '');
  for (const row of locality.rows) {
    const tr = doc.createElement('tr');
    if (row.postBoundary) tr.classList.add('post-boundary');

    const turnCell = doc.createElement('td');
    setText(turnCell, row.turnId);
    turnCell.className = 'mono';
    tr.appendChild(turnCell);

    const identityCell = doc.createElement('td');
    identityCell.className = row.wavSha256Equal ? 'verdict ok' : 'verdict bad';
    setText(identityCell, row.wavSha256Equal ? '✓ identical' : '✗ DIFFERS');
    tr.appendChild(identityCell);

    const baselineCell = doc.createElement('td');
    setText(baselineCell, formatStartSec(row.baselineStartMs));
    baselineCell.className = 'mono';
    tr.appendChild(baselineCell);

    const sessionCell = doc.createElement('td');
    setText(sessionCell, formatStartSec(row.sessionStartMs));
    sessionCell.className = 'mono';
    tr.appendChild(sessionCell);

    const shiftCell = doc.createElement('td');
    setText(shiftCell, formatMsDelta(row.startMsDelta));
    shiftCell.className = row.postBoundary ? 'mono shift' : 'mono shift zero';
    shiftCell.title = row.postBoundary
      ? `post-boundary shift (boundary ${record.afterTurnIndex})`
      : 'pre-boundary: no shift';
    tr.appendChild(shiftCell);

    ixLocalityBody.appendChild(tr);
  }

  setText(
    ixLocalityInvariant,
    locality.shiftEqualsInsertedTotal
      ? `⑂ invariant holds: post-boundary shift == inserted response total — ${formatMsDelta(locality.postBoundaryShiftMs)} == ${formatMsDelta(locality.insertedTotalMs)}`
      : `✗ INVARIANT VIOLATED: post-boundary shift ${formatMsDelta(locality.postBoundaryShiftMs)} != inserted response total ${formatMsDelta(locality.insertedTotalMs)}`,
  );
  ixLocalityInvariant.classList.toggle('ok', locality.shiftEqualsInsertedTotal);
  ixLocalityInvariant.classList.toggle('bad', !locality.shiftEqualsInsertedTotal);
}

function renderGrounding(record: SessionInterveneResponse): void {
  const grounding = record.grounding;
  setText(
    ixGroundingSummary,
    `F1 grounding check ${grounding.passed ? 'PASSED' : 'FAILED'} · ` +
      `${grounding.retrievedClaimIds.length} claim${grounding.retrievedClaimIds.length === 1 ? '' : 's'} retrieved ` +
      `${grounding.matchedByContent ? 'by content match' : 'by the honest fallback (top salience — the question matched no claim content)'}`,
  );
  ixGroundingSummary.classList.toggle('ok', grounding.passed);
  ixGroundingSummary.classList.toggle('bad', !grounding.passed);

  setText(ixGroundingClaims, '');
  for (const claim of grounding.claims) {
    const li = doc.createElement('li');
    li.className = 'ix-claim';
    const id = doc.createElement('span');
    id.className = 'mono ix-claim-id';
    setText(id, claim.claimId);
    const statement = doc.createElement('span');
    statement.className = 'ix-claim-statement';
    setText(statement, claim.statement);
    const salience = doc.createElement('span');
    salience.className = 'ix-claim-salience';
    setText(salience, `salience ${claim.salience.toFixed(2)}`);
    li.appendChild(id);
    li.appendChild(statement);
    li.appendChild(salience);
    ixGroundingClaims.appendChild(li);
  }

  setText(ixGroundingKv, '');
  kvRow(ixGroundingKv, 'Response turn', grounding.responseTurnId, { mono: true });
  kvRow(ixGroundingKv, 'Matched by content', grounding.matchedByContent ? 'yes' : 'no — fallback', {
    dim: true,
  });
  kvRow(ixGroundingKv, 'W1 deep validation', grounding.w1Valid ? 'valid' : 'INVALID', { dim: true });
  kvRow(ixGroundingKv, 'W2 dialogue-graph issues', String(grounding.w2IssueCount), { dim: true });
  kvRow(ixGroundingKv, 'Claims resolve in graph', grounding.claimsResolve ? 'yes' : 'NO', {
    dim: true,
  });
}

function renderProvenanceIx(record: SessionInterveneResponse): void {
  const provenance = record.provenance;
  setText(ixProvenanceKv, '');
  kvRow(ixProvenanceKv, 'Listener input', record.listenerInputMode, { dim: true });
  kvRow(ixProvenanceKv, 'Semantics', record.semantics, { dim: true });
  kvRow(ixProvenanceKv, 'Question', `“${record.listenerText}”`, { dim: true });
  kvRow(ixProvenanceKv, 'Boundary', `after turn ${record.afterTurnIndex}`, { dim: true });
  kvRow(ixProvenanceKv, 'Inserted turns', record.insertedTurnIds.join(' + '), { mono: true });
  kvRow(ixProvenanceKv, 'Seed', provenance.seed, { mono: true, dim: true });
  kvRow(ixProvenanceKv, 'Now', provenance.now, { mono: true, dim: true });
  kvRow(ixProvenanceKv, 'Mastering', provenance.mastering, { dim: true });
  kvRow(ixProvenanceKv, 'Response plan', provenance.responsePlanId, { mono: true, title: provenance.responsePlanId });
  kvRow(ixProvenanceKv, 'Response artifact', provenance.responseArtifactId, {
    mono: true,
    title: provenance.responseArtifactId,
  });
  kvRow(ixProvenanceKv, 'Session artifact', provenance.sessionArtifactId, {
    mono: true,
    title: provenance.sessionArtifactId,
  });
  kvRow(ixProvenanceKv, 'Session master sha256', shortHash(provenance.sessionMasterSha256), {
    mono: true,
    title: provenance.sessionMasterSha256,
  });
  // WFLX-UI3 audit fill (provenance completeness): the fields the machinery
  // already computes — response speech provider (handoff §4: provider is
  // never hidden), session lineage sourceIds, and the response segment QA
  // summary carried on the session artifact sidecar.
  kvRow(ixProvenanceKv, 'Response speech provider', record.response.provider, { dim: true });
  kvRow(ixProvenanceKv, 'Source ids', provenance.sourceIds.join(', '), {
    mono: true,
    dim: true,
    title: provenance.sourceIds.join(', '),
  });
  kvRow(
    ixProvenanceKv,
    'Response QA',
    `${provenance.responseQa.status}${provenance.responseQa.issueCount > 0 ? ` · ${provenance.responseQa.issueCount} issue(s)` : ''}`,
    { dim: true },
  );
  kvRow(
    ixProvenanceKv,
    'Reproducible',
    provenance.reproducible ? 'yes (byte-identical re-fork)' : 'no',
    { dim: true },
  );
  kvRow(ixProvenanceKv, 'Same machinery', provenance.sameMachineryNote, { dim: true });
}

// --- Fork history -----------------------------------------------------------

function renderHistory(): void {
  setText(ixHistoryList, '');
  const records = interactive.interventions;
  show(ixHistoryEmpty, records.length === 0);
  for (const record of records) {
    const li = doc.createElement('li');
    li.className = 'ix-history-item';
    if (interactive.latest?.interventionId === record.interventionId) {
      li.classList.add('current');
    }
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'ix-history-btn';
    const head = doc.createElement('span');
    head.className = 'ix-history-head';
    setText(
      head,
      `fork ${record.interventionSeq} · boundary ${record.afterTurnIndex} · “${record.listenerText}”`,
    );
    const meta = doc.createElement('span');
    meta.className = 'ix-history-meta mono';
    setText(
      meta,
      `${record.insertedTurnIds.join(' + ')} · sha ${shortHash(record.sessionMaster.sha256)}`,
    );
    const verdicts = doc.createElement('span');
    verdicts.className = 'ix-history-verdicts';
    setText(
      verdicts,
      `F1 ${record.grounding.passed ? '✓' : '✗'} · F2 ${record.locality.passed ? '✓' : '✗'} · order ${record.locality.originalOrderPreserved ? '✓' : '✗'}`,
    );
    button.appendChild(head);
    button.appendChild(meta);
    button.appendChild(verdicts);
    button.setAttribute(
      'aria-label',
      `Show fork ${record.interventionSeq}: boundary ${record.afterTurnIndex}, question ${record.listenerText}`,
    );
    button.addEventListener('click', () => {
      interactive.latest = record;
      renderIxResults();
      renderBoundaryStatus();
      renderHistory();
      if (interactive.activeMaster === 'session') {
        setActiveMaster('session');
      }
      renderTranscript();
      ixResultsWide.scrollIntoView({ block: 'start' });
    });
    li.appendChild(button);
    ixHistoryList.appendChild(li);
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

void (async () => {
  setPhase('empty');
  await Promise.all([loadHealth(), loadSources()]);
  renderModeControls();
})();
