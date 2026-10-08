import type { TaggedWord } from '@alivocab/shared';

/** A small hand-checked Polish starter set used by the dev seed. */
export const SAMPLE_WORDS: TaggedWord[] = [
  {
    lemma: 'dzień dobry',
    pos: 'phrase',
    translations: ['good morning', 'hello'],
    pronunciation: 'd͡ʑɛɲ ˈdɔbrɨ',
    examples: [
      {
        text: 'Dzień dobry, poproszę kawę.',
        translation: 'Hello, a coffee please.',
        cloze: 'Dzień dobry',
      },
    ],
    status: 'known',
  },
  {
    lemma: 'dziękować',
    pos: 'verb',
    aspect: 'impf',
    aspectPair: 'podziękować',
    translations: ['to thank'],
    forms: {
      pres_1sg: 'dziękuję',
      pres_2sg: 'dziękujesz',
      pres_3pl: 'dziękują',
      past_m: 'dziękował',
    },
    examples: [
      { text: 'Dziękuję za pomoc!', translation: 'Thank you for the help!', cloze: 'Dziękuję' },
    ],
    status: 'recognize',
  },
  {
    lemma: 'chleb',
    pos: 'noun',
    gender: 'm',
    translations: ['bread'],
    forms: { gen_sg: 'chleba', nom_pl: 'chleby', ins_sg: 'chlebem' },
    pronunciation: 'xlɛp',
    examples: [
      { text: 'Kupiłem świeży chleb.', translation: 'I bought fresh bread.', cloze: 'chleb' },
    ],
    notes: 'Final -b is pronounced [p].',
    status: 'unknown',
  },
  {
    lemma: 'woda',
    pos: 'noun',
    gender: 'f',
    translations: ['water'],
    forms: { gen_sg: 'wody', nom_pl: 'wody', ins_sg: 'wodą' },
    examples: [
      { text: 'Poproszę szklankę wody.', translation: 'A glass of water, please.', cloze: 'wody' },
    ],
    status: 'known',
  },
  {
    lemma: 'mieszkanie',
    pos: 'noun',
    gender: 'n',
    translations: ['flat', 'apartment'],
    forms: { gen_sg: 'mieszkania', nom_pl: 'mieszkania', ins_sg: 'mieszkaniem' },
    examples: [
      { text: 'Moje mieszkanie jest małe.', translation: 'My flat is small.', cloze: 'mieszkanie' },
    ],
    status: 'unknown',
  },
  {
    lemma: 'mówić',
    pos: 'verb',
    aspect: 'impf',
    aspectPair: 'powiedzieć',
    translations: ['to speak', 'to say'],
    forms: { pres_1sg: 'mówię', pres_2sg: 'mówisz', pres_3pl: 'mówią', past_m: 'mówił' },
    examples: [
      { text: 'Mówię trochę po polsku.', translation: 'I speak a little Polish.', cloze: 'Mówię' },
    ],
    status: 'recognize',
  },
  {
    lemma: 'ładny',
    pos: 'adjective',
    translations: ['pretty', 'nice'],
    forms: { f: 'ładna', n: 'ładne', nom_pl_virile: 'ładni' },
    examples: [{ text: 'Jaki ładny dzień!', translation: 'What a nice day!', cloze: 'ładny' }],
    status: 'untagged',
  },
  {
    lemma: 'jutro',
    pos: 'adverb',
    translations: ['tomorrow'],
    examples: [{ text: 'Do zobaczenia jutro.', translation: 'See you tomorrow.', cloze: 'jutro' }],
    status: 'unknown',
  },
];
