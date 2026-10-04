/**
 * WebFlix-Lab shared IR — per-unit content-keyed seeding hash (C-5, v2
 * contract wave; ruling 2026-09-29).
 *
 * ONE derivation shared by every surface that keys stochastic choices on a
 * unit's OWN content, replacing the plan-global planHash in STOCHASTIC keys.
 * Rationale (strongest evidence in the v2 candidate register):
 *   - EV-006 EXP-A-04 (audio, run evidence): a one-paragraph source mutation
 *     left graph+plan perfectly local (0/25 structures changed) but
 *     reshuffled 21/25 realized texts — the planHash-keyed PRNG stream
 *     changed for EVERY turn (the EV-005 determinism trap), defeating
 *     AGENTS.md's "regenerate the smallest failed unit" architecture rule.
 *   - EV-011 EXP-V-04 (video, run evidence): the same defect class on the
 *     video surface — 9/12 scene SVGs reshuffled, structure 0/12.
 *   - EV-009 LAB-05/06 (product truth): the real product has NO turn-local
 *     stability either (it globally re-plans on any change) — C-5 is OUR
 *     lab's diff hygiene and the smallest-unit-regeneration rule, NOT
 *     product parity.
 *
 * Determinism contract (corrected wave mechanics, ruling 2026-09-29):
 * re-keying changes the PRNG stream, so same-plan outputs CHANGE ONCE at
 * the v2 boundary and committed fingerprints regenerate in the same change.
 * WITHIN a contract version, same plan + same seed -> byte-identical
 * outputs (double-run verified); across plan mutations, UNCHANGED units
 * keep their surfaces (the improved diff semantics EXP-X-02 verifies
 * post-landing).
 *
 * planHash is REMOVED from stochastic keys and STAYS in identification
 * surfaces only (graph meta, artifact ids, manifests, plan fingerprints) —
 * it is plan-global BY DESIGN there.
 *
 * Surface compositions (the authoritative list; every surface below keys
 * its PRNG on `seed | unitContentHash(...) | <pure unit id> | <slot>`):
 *
 *   AUDIO TURN (src/audio/dialogue/text/realizer.ts, turnContentHash):
 *     [turn.brief, ...anchorStatements] where anchorStatements are the
 *     turn's cited claim statements (anchor-sentenced, in claimIds order;
 *     empty for zero-claim turns, so the hash is the turn's own brief).
 *     Keys: seed|turnContentHash|turnId|slot (turnId stays a PURE
 *     identifier — it never feeds the hash).
 *
 *   AUDIO TIMING GAP (src/audio/timing/timing.ts, gapMsFor):
 *     [turnHashA, turnHashB] — the unitContentHash of the two
 *     gap-adjacent AUDIO TURN hashes above. Keys:
 *     seed|unitContentHash([turnHashA, turnHashB])|gap-N|boundary (the gap
 *     index and boundary class stay pure identifiers).
 *
 *   VIDEO SCENE (src/video/storyboard/compiler.ts, compileVideoScenes):
 *     [scene.narrativePurpose, scene.narrationBrief, visualBrief,
 *     ...anchorStatements, ...exactTexts] where anchorStatements are the
 *     scene's grounded claim statements (in claimIds order) and
 *     exactTexts encode as 'role:value' pairs; visualBrief is the plan's
 *     own editorial brief ('' when absent — the DERIVED brief is a
 *     function of this key, so it must not feed the hash). Keys:
 *     seed|sceneHash|mode|sceneId (mode and sceneId stay pure
 *     identifiers).
 *
 * The hash itself: lowercase-hex SHA-256 over the JSON encoding of the
 * parts array (order-sensitive, each part a distinct JSON string — no
 * concatenation ambiguity). Identical parts -> identical hash, on every
 * platform, forever.
 */

import { createHash } from 'node:crypto';

/**
 * Content-keyed seeding hash of one unit's OWN parts (composition per the
 * module docblock — the docblock is the contract).
 */
export function unitContentHash(parts: readonly string[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}
