/**
 * Audio pipeline (WFLX-W2, Stage 2) — language surface packs.
 *
 * DESIGN.md §11: the graph structure (purposes, ordering, coverage, links) is
 * language-invariant; surface realization (templates, discourse markers) is
 * localized. Claim ids are the cross-language anchor.
 *
 * 'en' is the full base pack; 'es' is a minimal lab-local pack sufficient for
 * the H-A-06 structural test (identical structure, different surface). Any
 * other language tag falls back to 'en' and the QA layer raises an
 * `info`-severity `language-pack-fallback` note — honest, never silent.
 */

import type { SurfacePack, TagFamily } from './common';

const EN_OPENERS: Readonly<Partial<Record<TagFamily, readonly string[]>>> = {
  statement: [
    'So,',
    "Okay — here's the core of it:",
    "Here's what stands out:",
    'Right.',
    "Let's unpack that.",
  ],
  question: [
    "Now, something I'm wondering:",
    'Okay, a question:',
    'Help me with this:',
    'This is the part I want to probe:',
  ],
  example: ['For instance:', 'Case in point:', 'Think of it like this:', 'Concrete example:'],
  framing: ["Let's set the scene.", 'First things first.', 'Alright.', "Here's where we are:"],
  transition: ["Okay, moving on.", "Next up.", "Let's shift gears.", 'Which brings us to:'],
  connection: [
    "And here's how it ties together:",
    'This connects back:',
    'Notice the through-line:',
  ],
  synthesis: ['Pulling it together:', 'So the big picture:', 'Zooming out:'],
  conclusion: ['So, the takeaway:', 'To wrap:', 'Bottom line:'],
  verdict: ['So, weighing all of it:', 'Our read, on balance:', 'The judgment:'],
  clarification: ['To be clear:', 'Let me sharpen that:', 'Put differently:'],
  rebuttal: ["I'd push back:", 'Counterpoint:', 'Not so fast —'],
  position: ['Our position:', "Here's where we stand:", 'For the motion:'],
  concession: ['Fair point —', "We'll grant this:", 'You got us there:'],
  interjection: ['Right.', 'Mm-hm.', 'Exactly.', 'Got it.'],
};

const EN_CLOSERS: Readonly<Partial<Record<TagFamily, readonly string[]>>> = {
  statement: ["That's the substance of it.", 'That is the heart of it.', 'And that lands.'],
  conclusion: ["That's the story.", "That's the through-line.", 'Keep that in mind.'],
  verdict: ['That is our verdict.', 'That is where we land.'],
  synthesis: ['It all points one way.', 'The pieces fit.'],
};

/** English base pack. */
export const EN_PACK: SurfacePack = {
  openers: EN_OPENERS,
  closers: EN_CLOSERS,
  questionTails: [
    'how far does that actually go?',
    'what does that mean in practice?',
    'why does that matter here?',
    "what's the real scope there?",
  ],
  anchorConnectors: [' and — beyond that — ', '; also, ', ', and ', ' plus '],
  acknowledgePrefixes: ['Right —', 'Good question —', 'So, about that —'],
  continuationPrefixes: ['And —', 'Plus —', 'Building on that —'],
  evidenceIntros: ["In the source's words:", 'As the note itself puts it:', 'Straight from the source:'],
};

const ES_OPENERS: Readonly<Partial<Record<TagFamily, readonly string[]>>> = {
  statement: [
    'Entonces,',
    'Bien — aquí está lo esencial:',
    'Esto es lo que destaca:',
    'Correcto.',
    'Vamos a desglosarlo.',
  ],
  question: [
    'Ahora, algo que me pregunto:',
    'Bien, una pregunta:',
    'Ayúdame con esto:',
    'Esta es la parte que quiero explorar:',
  ],
  example: ['Por ejemplo:', 'Caso concreto:', 'Pensadlo así:'],
  framing: ['Sitémonos en contexto.', 'Primero lo primero.', 'De acuerdo.'],
  transition: ['Bien, seguimos.', 'Lo siguiente.', 'Cambiemos de tema.'],
  connection: ['Y aquí está cómo se conecta:', 'Esto enlaza con lo anterior:'],
  synthesis: ['Juntándolo todo:', 'El panorama general:'],
  conclusion: ['Entonces, la conclusión:', 'Para cerrar:', 'En resumen:'],
  verdict: ['Sopesándolo todo:', 'Nuestra lectura, en conjunto:'],
  clarification: ['Para ser claros:', 'Déjame precisarlo:', 'Dicho de otro modo:'],
  rebuttal: ['Yo lo cuestionaría:', 'Contraargumento:', 'Sin tanto rapel —'],
  position: ['Nuestra postura:', 'Aquí es donde nos paramos:'],
  concession: ['Punto justo —', 'Lo concedemos:'],
  interjection: ['Claro.', 'Ajá.', 'Exacto.', 'Entendido.'],
};

/** Spanish minimal pack (lab-local; surface localization for H-A-06 tests). */
export const ES_PACK: SurfacePack = {
  openers: ES_OPENERS,
  closers: {
    statement: ['Esa es la sustancia.', 'Eso es lo esencial.'],
    conclusion: ['Esa es la historia.', 'Esa es la línea que lo une todo.'],
    verdict: ['Ese es nuestro veredicto.'],
  },
  questionTails: [
    '¿hasta dónde llega eso realmente?',
    '¿qué significa en la práctica?',
    '¿por qué importa esto aquí?',
  ],
  anchorConnectors: [' y — además — ', '; también, ', ', y ', ' más '],
  acknowledgePrefixes: ['Claro —', 'Buena pregunta —', 'Sobre eso —'],
  continuationPrefixes: ['Y —', 'Además —', 'Siguiendo esa idea —'],
  evidenceIntros: ['En palabras de la fuente:', 'Como dice la propia nota:'],
};

export type LanguagePackId = 'en' | 'es';

/** Select the base language pack for a BCP-47 tag; null => fallback to en + QA note. */
export function languagePackFor(language: string): { pack: SurfacePack; id: LanguagePackId; fallback: boolean } {
  const normalized = language.toLowerCase();
  if (normalized === 'en' || normalized.startsWith('en-')) {
    return { pack: EN_PACK, id: 'en', fallback: false };
  }
  if (normalized === 'es' || normalized.startsWith('es-')) {
    return { pack: ES_PACK, id: 'es', fallback: false };
  }
  return { pack: EN_PACK, id: 'en', fallback: true };
}
