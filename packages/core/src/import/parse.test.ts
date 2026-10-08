import { describe, expect, it } from 'vitest';
import { parseVocabulary } from './parse.ts';

const opts = { lang: 'pl', nativeLang: 'en' };
const parse = (raw: string) => parseVocabulary(raw, opts);

describe('parseVocabulary: JSON', () => {
  it('parses the prompt format wrapped in prose and fences', () => {
    const raw = `Sure! Here are your words:

\`\`\`json
{"words":[
  {"lemma":"chleb","pos":"noun","gender":"m","translations":["bread"],
   "forms":{"gen_sg":"chleba","nom_pl":"chleby"},"pronunciation":"/xlɛp/",
   "examples":[{"text":"Kupiłem świeży chleb.","translation":"I bought fresh bread.","cloze":"chleb"}],
   "notes":"Final -b devoices."},
  {"lemma":"kupić","pos":"verb","aspect":"pf","aspect_pair":"kupować","translations":["to buy"],
   "examples":[{"text":"Chcę kupić bułki.","translation":"I want to buy rolls.","cloze":"kupić"}]}
]}
\`\`\`
Let me know if you need more!`;
    const { format, words, issues } = parse(raw);
    expect(format).toBe('json');
    expect(issues).toEqual([]);
    expect(words).toHaveLength(2);
    expect(words[0]).toMatchObject({
      lemma: 'chleb',
      pos: 'noun',
      gender: 'm',
      forms: { gen_sg: 'chleba', nom_pl: 'chleby' },
      pronunciation: 'xlɛp',
      notes: 'Final -b devoices.',
    });
    expect(words[0]?.examples[0]).toEqual({
      text: 'Kupiłem świeży chleb.',
      translation: 'I bought fresh bread.',
      cloze: 'chleb',
    });
    expect(words[1]).toMatchObject({
      pos: 'verb',
      aspect: 'pf',
      aspectPair: 'kupować',
      gender: null,
    });
  });

  it('repairs broken JSON (trailing commas, single quotes, unquoted keys)', () => {
    const raw = `[{lemma: 'masło', pos: 'rzeczownik', gender: 'nijaki', translation: 'butter',},]`;
    const { words, issues } = parse(raw);
    expect(issues).toEqual([]);
    expect(words[0]).toMatchObject({
      lemma: 'masło',
      pos: 'noun',
      gender: 'n',
      translations: ['butter'],
    });
  });

  it('accepts other key names and a bare array', () => {
    const raw = JSON.stringify([
      {
        Polish: 'ciastko',
        English: 'cookie, biscuit',
        type: 'Noun (n)',
        example: 'To ciastko jest pyszne.',
      },
    ]);
    const [word] = parse(raw).words;
    expect(word).toMatchObject({
      lemma: 'ciastko',
      translations: ['cookie', 'biscuit'],
      gender: 'n',
    });
    expect(word?.examples[0]).toMatchObject({ text: 'To ciastko jest pyszne.', cloze: 'ciastko' });
  });

  it('merges multiple fenced batches and NDJSON', () => {
    const raw =
      '```json\n{"words":[{"lemma":"a","pos":"noun","translations":["x"]}]}\n```\n\n```json\n{"lemma":"b","pos":"noun","translations":["y"]}\n{"lemma":"c","pos":"noun","translations":["z"]}\n```';
    expect(parse(raw).words.map((w) => w.lemma)).toEqual(['a', 'b', 'c']);
  });

  it('ignores <think> blocks from reasoning models', () => {
    const raw =
      '<think>Let me think about {braces} and words…</think>\n{"words":[{"lemma":"ser","pos":"noun","translations":["cheese"]}]}';
    expect(parse(raw).words.map((w) => w.lemma)).toEqual(['ser']);
  });

  it('reads a simple lemma → translation map', () => {
    const { words } = parse('{"jabłko": "apple", "gruszka": "pear"}');
    expect(words.map((w) => [w.lemma, w.translations[0]])).toEqual([
      ['jabłko', 'apple'],
      ['gruszka', 'pear'],
    ]);
  });
});

describe('parseVocabulary: CSV and tables', () => {
  it('parses semicolon CSV with header, quoting, pipes and forms', () => {
    const raw = `lemma;translation;pos;gender;aspect;aspect_pair;forms;pronunciation;example;example_translation;cloze;notes
chleb;bread|loaf;noun;m;;;gen_sg=chleba|nom_pl=chleby;xlɛp;"Kupiłem chleb; był ciepły.";I bought bread; it was warm.;chleb;
piec;to bake;verb;;impf;upiec;;pʲɛt͡s;Mama piecze ciasto.;Mom is baking a cake.;piecze;irregular`;
    const { format, words, issues } = parse(raw);
    expect(format).toBe('csv');
    expect(issues).toEqual([]);
    expect(words[0]).toMatchObject({
      lemma: 'chleb',
      translations: ['bread', 'loaf'],
      forms: { gen_sg: 'chleba', nom_pl: 'chleby' },
    });
    expect(words[0]?.examples[0]?.text).toBe('Kupiłem chleb; był ciepły.');
    expect(words[1]).toMatchObject({
      pos: 'verb',
      aspect: 'impf',
      aspectPair: 'upiec',
      notes: 'irregular',
    });
    expect(words[1]?.examples[0]?.cloze).toBe('piecze');
  });

  it('parses tab-separated spreadsheet pastes with localized headers', () => {
    const raw = 'Polish\tEnglish\tPart of speech\nrogal\tcroissant\tnoun\nsłodki\tsweet\tadj';
    const { words } = parse(raw);
    expect(words.map((w) => [w.lemma, w.pos])).toEqual([
      ['rogal', 'noun'],
      ['słodki', 'adjective'],
    ]);
  });

  it('parses Markdown tables from chat answers', () => {
    const raw = `| Polish | English | POS |
|---|---|---|
| **drożdże** | yeast | noun (mp) |
| mąka | flour | noun |`;
    const { format, words } = parse(raw);
    expect(format).toBe('table');
    expect(words[0]).toMatchObject({ lemma: 'drożdże', translations: ['yeast'] });
    expect(words[1]?.lemma).toBe('mąka');
  });

  it('assumes positional columns without a header', () => {
    const { words, issues } = parse('kawa;coffee;noun;f\nherbata;tea;noun;f');
    expect(words.map((w) => w.gender)).toEqual(['f', 'f']);
    expect(issues.some((i) => i.message.includes('No header row'))).toBe(true);
  });
});

describe('parseVocabulary: plain lists', () => {
  it('parses "word – translation" lines with numbering and gender', () => {
    const raw = `1. piekarnia (f) – bakery
2. sprzedawca (m) - shop assistant
- bułka: bread roll
• dzień dobry → good morning`;
    const { format, words, issues } = parse(raw);
    expect(format).toBe('list');
    expect(words.map((w) => [w.lemma, w.gender, w.pos])).toEqual([
      ['piekarnia', 'f', 'noun'],
      ['sprzedawca', 'm', 'noun'],
      ['bułka', null, 'noun'],
      ['dzień dobry', null, 'phrase'],
    ]);
    expect(issues.filter((i) => i.message.includes('Part of speech missing'))).toHaveLength(4);
  });
});

describe('parseVocabulary: validation and cleanup', () => {
  it('skips rows without lemma or translation and reports them', () => {
    const raw = JSON.stringify({
      words: [
        { lemma: '', translations: ['x'] },
        { lemma: 'cukier', pos: 'noun' },
        { lemma: 'sól', pos: 'noun', translations: ['salt'] },
      ],
    });
    const { words, issues } = parse(raw);
    expect(words.map((w) => w.lemma)).toEqual(['sól']);
    expect(issues.map((i) => [i.row, i.severity])).toEqual([
      [1, 'error'],
      [2, 'error'],
    ]);
  });

  it('merges duplicates (same lemma and pos, case-insensitive)', () => {
    const raw = JSON.stringify([
      { lemma: 'Chleb', pos: 'noun', translations: ['bread'] },
      { lemma: 'chleb', pos: 'noun', translations: ['loaf'], gender: 'm' },
      { lemma: 'chleb', pos: 'verb', translations: ['(not real)'] },
    ]);
    const { words, issues } = parse(raw);
    expect(words).toHaveLength(2);
    expect(words[0]).toMatchObject({ translations: ['bread', 'loaf'], gender: 'm' });
    expect(issues).toMatchObject([{ row: 2, message: 'Duplicate of row 1; merged' }]);
  });

  it('drops gender/aspect where they do not apply and fixes cloze', () => {
    const raw = JSON.stringify([
      {
        lemma: 'smaczny',
        pos: 'adjective',
        gender: 'm',
        aspect: 'pf',
        translations: ['tasty'],
        examples: [{ text: 'Ta zupa jest smaczna.', cloze: 'smaczny' }],
      },
    ]);
    const [word] = parse(raw).words;
    expect(word).toMatchObject({ gender: null, aspect: null });
    expect(word?.examples[0]?.cloze).toBeNull();
  });

  it('keeps diacritics and normalizes Unicode', () => {
    const decomposed = 'żółw'; // ż + ó as combining marks
    const [word] = parse(
      JSON.stringify([{ lemma: decomposed, pos: 'noun', translations: ['turtle'] }]),
    ).words;
    expect(word?.lemma).toBe('żółw');
  });

  it('reports unparseable input', () => {
    const { words, issues } = parse('I could not come up with anything, sorry.');
    expect(words).toEqual([]);
    expect(issues[0]?.severity).toBe('error');
  });
});
