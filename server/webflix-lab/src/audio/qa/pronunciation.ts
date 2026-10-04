/**
 * Audio pipeline (WFLX-W2, Stage 2) — pronunciation risk detection.
 *
 * DESIGN.md §9.8: unusual tokens are flagged (acronyms, mixed case, digits,
 * symbols, long technical tokens, proper nouns) for hint generation. Hints
 * are deterministic transformations; unresolved tokens are flagged with their
 * original form so a human or provider can decide. The metric is
 * info-severity — it feeds `SpeechTurnRequest.pronunciationHints` and the QA
 * report, never blocks compilation.
 */

import type { PronunciationHint, PronunciationRiskReason } from '../../providers/audio/port';

/** A flagged token plus its deterministic spoken substitution. */
export interface PronunciationRisk {
  readonly token: string;
  readonly say: string;
  readonly reason: PronunciationRiskReason;
}

const ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen',
] as const;
const TENS = [
  '', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety',
] as const;

/** English number rendering for integers 0..999,999,999 (deterministic). */
export function numberToWords(value: number): string {
  if (!Number.isInteger(value) || value < 0 || value > 999_999_999) {
    return String(value);
  }
  if (value < 20) return ONES[value] ?? String(value);
  if (value < 100) {
    const tens = Math.floor(value / 10);
    const rest = value % 10;
    return rest === 0 ? (TENS[tens] ?? '') : `${TENS[tens]}-${ONES[rest]}`;
  }
  if (value < 1000) {
    const hundreds = Math.floor(value / 100);
    const rest = value % 100;
    return rest === 0 ? `${ONES[hundreds]} hundred` : `${ONES[hundreds]} hundred ${numberToWords(rest)}`;
  }
  if (value < 1_000_000) {
    const thousands = Math.floor(value / 1000);
    const rest = value % 1000;
    return rest === 0 ? `${numberToWords(thousands)} thousand` : `${numberToWords(thousands)} thousand ${numberToWords(rest)}`;
  }
  const millions = Math.floor(value / 1_000_000);
  const rest = value % 1_000_000;
  return rest === 0 ? `${numberToWords(millions)} million` : `${numberToWords(millions)} million ${numberToWords(rest)}`;
}

const SYMBOL_EXPANSIONS: Readonly<Record<string, string>> = {
  '/': ' slash ',
  '+': ' plus ',
  '&': ' and ',
  '#': ' hash ',
  '@': ' at ',
  '=': ' equals ',
  '%': ' percent ',
};

/** Common sentence words that are capitalized naturally — not proper-noun risks. */
const COMMON_CAPITALIZED = new Set([
  'I', "I'm", "I've", "I'll", 'Okay', 'Right', 'So', 'And', 'But', 'The', 'This',
  'That', 'These', 'Those', 'Next', 'First', 'Now', 'Here', 'There', 'What',
  'Why', 'How', 'When', 'Where', 'Who', 'Plus', 'Also', 'For', 'To', 'In', 'On',
  'With', 'Without', 'Notice', 'Pulling', 'Zooming', 'Bottom', 'Case', 'Think',
  'Concrete', 'Fair', 'Good', 'Great', 'Exactly', 'Alright', 'Entonces', 'Bien',
  'Vamos', 'Sitémonos',
]);

function splitCamel(token: string): string {
  return token
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function spellOut(token: string): string {
  return token.split('').join(' ');
}

function expandSymbols(token: string): string | null {
  let out = '';
  let changed = false;
  for (const ch of token) {
    const expansion = SYMBOL_EXPANSIONS[ch];
    if (expansion !== undefined) {
      out += expansion;
      changed = true;
    } else {
      out += ch;
    }
  }
  return changed ? out.replace(/\s+/g, ' ').trim() : null;
}

function riskForToken(token: string, sentenceInitial: boolean): PronunciationRisk | null {
  const bare = token.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
  if (bare.length < 2) return null;

  // Symbols inside tokens: "Postgres/Neon" -> "Postgres slash Neon".
  const expanded = expandSymbols(bare);
  if (expanded !== null) {
    return { token: bare, say: expanded, reason: 'symbols' };
  }

  // Acronyms: ALL-CAPS alphabetic, 2+ letters.
  if (/^[A-Z]{2,}$/.test(bare)) {
    return { token: bare, say: spellOut(bare), reason: 'acronym' };
  }

  // Pure integers: spell them out.
  if (/^\d+$/.test(bare)) {
    return { token: bare, say: numberToWords(Number(bare)), reason: 'digits' };
  }

  // Mixed case (camelCase): "digitalTwin" -> "digital Twin".
  if (/[a-z][A-Z]/.test(bare)) {
    return { token: bare, say: splitCamel(bare), reason: 'mixed-case' };
  }

  // Long technical tokens: split on camel/hyphen/slash boundaries.
  if (bare.length >= 16) {
    const split = splitCamel(bare);
    if (split !== bare) {
      return { token: bare, say: split, reason: 'long-token' };
    }
    return { token: bare, say: bare, reason: 'long-token' };
  }

  // Proper nouns: capitalized, mid-sentence, not a common sentence word.
  if (!sentenceInitial && /^[A-Z][a-z']+$/.test(bare) && !COMMON_CAPITALIZED.has(bare)) {
    return { token: bare, say: bare, reason: 'proper-noun' };
  }

  return null;
}

/** Scan a realized text for pronunciation risks (deduplicated per token). */
export function scanPronunciationRisks(text: string): readonly PronunciationRisk[] {
  const seen = new Map<string, PronunciationRisk>();
  const sentences = text.split(/(?<=[.!?])\s+/);
  for (const sentence of sentences) {
    const tokens = sentence.split(/\s+/).filter((t) => t.length > 0);
    tokens.forEach((token, i) => {
      const risk = riskForToken(token, i === 0);
      if (risk !== null && !seen.has(risk.token)) {
        seen.set(risk.token, risk);
      }
    });
  }
  return [...seen.values()];
}

/** Convert risks to provider-neutral hints (port shape). */
export function risksToHints(risks: readonly PronunciationRisk[]): readonly PronunciationHint[] {
  return risks.map((risk) => ({ token: risk.token, say: risk.say, reason: risk.reason }));
}
