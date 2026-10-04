# WebFlix-Lab Agent Rules

## Authority

The repository is the source of truth. Do not rely on the originating conversation for missing requirements.

Read before coding:
- README.md
- docs/handoff/tl2-overview-studio-handoff.md
- docs/reference/gemini-notebook-access.md
- docs/reference/reference-artifact-manifest.json
- docs/experiments/protocol.md
- docs/work-items/tl2-work-order.md
- apps/studio/README.md

## Evidence discipline

Tag statements and artifacts as:
- OBSERVED — directly observed in the real Gemini Notebook UI or generated artifact.
- DOCUMENTED — supported by official/public documentation.
- HYPOTHESIS — inferred from black-box behavior.
- REPRODUCED — reproduced by the lab implementation.
- UNRESOLVED — not established.

Never silently promote HYPOTHESIS to FACT.

Fixture-only success is not product parity evidence.

## Reference access

A human operator authenticates into the Gemini Notebook reference environment. Workers may reuse the authorized browser session or an officially shared notebook according to docs/reference/gemini-notebook-access.md.

Never request or store the human's Google password, recovery codes, session cookies, OAuth tokens, browser archives, or API keys.

Never commit authentication state.

## Experiment discipline

Every black-box run records:
- experiment id
- timestamp
- source fingerprint
- notebook configuration
- requested mode
- custom prompt
- source selection
- artifact id
- observed behavior
- changed variable
- invariants
- hypothesis
- confidence
- follow-up

Change one meaningful variable at a time whenever practical.

Use the exact reference artifact before generating a prettier replacement.

## Concurrency

TL #2 is the only owner of shared contracts.

Worker 1: src/source, src/director, src/contracts, tests/source, tests/director.
Worker 2: src/audio, src/providers/audio, tests/audio.
Worker 3: src/video, src/providers/visual, src/providers/video, src/compositor, tests/video.

Do not modify another worker's owned tree without TL #2 coordination.

## Architecture

Use a typed multi-stage compiler:

Source -> Understand -> Plan -> Script/Storyboard -> Generate -> Compose -> Evaluate -> Publish

The Director owns editorial decisions, not media generation.

Use deterministic rendering for exact labels, numbers, relationships and diagrams. Use generative models for illustration, metaphor and atmosphere. Use video generation only when motion adds explanatory value.

Regenerate the smallest failed unit instead of regenerating a whole artifact.

## WebFlix boundary

This lab must not directly modify payswapdotorg/WebFlix.

The final deliverable is a promotion and integration handoff, not an unreviewed production change.

## Validation

When browser automation is available, use agent-browser for real UI inspection and evidence capture. Follow the documented workflow: open -> wait networkidle -> fresh snapshot -> interact -> fresh snapshot -> screenshot/evidence.

Never claim a user journey is complete solely because code paths or unit tests pass.
