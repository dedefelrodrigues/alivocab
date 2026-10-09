import { describe, expect, it } from 'vitest';
import { acceptedAnswers, checkAnswer, editDistance } from './answer.ts';
import { buildCloze, type ChoiceCandidate, pickDistractors, shuffle } from './choices.ts';
import { pickDrill } from './drills.ts';
import { chooseExercise, ratingFor } from './plan.ts';

/** Deterministic pseudo-random numbers for tests. */
function seeded(seed = 1) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

describe('checkAnswer', () => {
  const pl = (given: string, ...accepted: string[]) => checkAnswer(given, accepted, 'pl');

  it('accepts exact answers, ignoring case, spacing and punctuation', () => {
    expect(pl('  Dzień  dobry! ', 'dzień dobry').verdict).toBe('correct');
    expect(pl('ŻÓŁW', 'żółw').verdict).toBe('correct');
  });

  it('accepts missing diacritics but flags them, including ł', () => {
    expect(pl('zolw', 'żółw')).toEqual({ verdict: 'accents', expected: 'żółw' });
    expect(pl('dlugi', 'długi').verdict).toBe('accents');
  });

  it('accepts one typo in longer words only', () => {
    expect(pl('mieszkanei', 'mieszkanie').verdict).toBe('wrong'); // a swap is two edits
    expect(pl('mieszkane', 'mieszkanie').verdict).toBe('typo');
    expect(pl('kit', 'kot').verdict).toBe('wrong');
    expect(pl('chlep', 'chleb').verdict).toBe('typo');
    expect(pl('mowic', 'mówić').verdict).toBe('accents');
    expect(pl('mowi', 'mówić').verdict).toBe('typo');
  });

  it('rejects wrong and empty answers', () => {
    expect(pl('pies', 'kot')).toEqual({ verdict: 'wrong', expected: 'kot' });
    expect(pl('   ', 'kot').verdict).toBe('wrong');
  });

  it('picks the best of several accepted answers', () => {
    expect(pl('rogalik', 'rogal', 'rogalik')).toEqual({ verdict: 'correct', expected: 'rogalik' });
  });

  it('ignores English filler words', () => {
    expect(checkAnswer('peel', acceptedAnswers(['to peel']), 'en').verdict).toBe('correct');
    expect(checkAnswer('the house', ['house'], 'en').verdict).toBe('correct');
  });
});

describe('acceptedAnswers', () => {
  it('splits alternatives and drops notes in parentheses', () => {
    expect(acceptedAnswers(['pit (of a fruit), stone', 'seed'])).toEqual([
      'pit, stone',
      'pit',
      'stone',
      'seed',
    ]);
  });
});

describe('editDistance', () => {
  it('counts insertions, deletions and substitutions', () => {
    expect(editDistance('kot', 'kot')).toBe(0);
    expect(editDistance('kot', 'kota')).toBe(1);
    expect(editDistance('kot', 'pies')).toBe(4);
    expect(editDistance('kot', 'pies', 1)).toBe(2); // stops early
  });
});

const word = (id: string, extra: Partial<ChoiceCandidate> = {}): ChoiceCandidate => ({
  id,
  lemma: id,
  pos: 'noun',
  gender: 'm',
  translations: [`${id}-en`],
  hasImage: false,
  sameTheme: false,
  ...extra,
});

describe('pickDistractors', () => {
  const opts = { lang: 'pl', nativeLang: 'en', rand: seeded(7) } as const;

  it('prefers words from the same theme and with the same part of speech', () => {
    const pool = [
      word('verb', { pos: 'verb', sameTheme: true }),
      word('far1'),
      word('far2'),
      word('near1', { sameTheme: true }),
      word('near2', { sameTheme: true }),
      word('near3', { sameTheme: true }),
    ];
    const picked = pickDistractors(word('target', { sameTheme: true }), pool, {
      ...opts,
      mode: 'lemma',
    });
    expect(picked.map((c) => c.id).sort()).toEqual(['near1', 'near2', 'near3']);
  });

  it('never offers another correct answer or duplicate-looking options', () => {
    const target = word('pestka', { translations: ['pit', 'stone'] });
    const pool = [
      word('kamień', { translations: ['stone'] }), // same meaning: would also be right
      word('Pestka'), // same word, other casing
      word('a', { translations: ['apple'] }),
      word('b', { translations: ['apple'] }), // looks the same as "a"
      word('c', { translations: ['cherry'] }),
    ];
    const picked = pickDistractors(target, pool, { ...opts, mode: 'meaning' });
    expect(picked.map((c) => c.translations[0]).sort()).toEqual(['apple', 'cherry']);
  });

  it('uses only words with pictures for picture options', () => {
    const pool = [word('a', { hasImage: true }), word('b'), word('c', { hasImage: true })];
    const picked = pickDistractors(word('t'), pool, { ...opts, mode: 'image' });
    expect(picked.map((c) => c.id).sort()).toEqual(['a', 'c']);
  });
});

describe('shuffle', () => {
  it('keeps every item', () => {
    expect(shuffle([1, 2, 3, 4], seeded(3)).sort()).toEqual([1, 2, 3, 4]);
  });
});

describe('buildCloze', () => {
  it('blanks the word form as a whole word, case-insensitively', () => {
    expect(buildCloze('Poproszę szklankę wody.', 'wody', 'pl')).toEqual({
      before: 'Poproszę szklankę ',
      answer: 'wody',
      after: '.',
    });
    expect(buildCloze('Dzień dobry, poproszę kawę.', 'dzień dobry', 'pl')?.answer).toBe(
      'Dzień dobry',
    );
  });

  it('skips matches inside other words', () => {
    expect(buildCloze('Kotek i kot śpią.', 'kot', 'pl')).toEqual({
      before: 'Kotek i ',
      answer: 'kot',
      after: ' śpią.',
    });
    expect(buildCloze('Kotek śpi.', 'kot', 'pl')).toBeNull();
    expect(buildCloze('Kotek śpi.', null, 'pl')).toBeNull();
  });
});

describe('chooseExercise', () => {
  const base = {
    stability: 0,
    hasImage: false,
    canChoosePicture: false,
    canChooseText: true,
    hasCloze: false,
    rand: () => 0.1,
  };

  it('introduces new words with a flashcard', () => {
    expect(chooseExercise({ ...base, direction: 'recognition', state: 0 })).toBe('intro');
  });

  it('uses choices for recognition and while recall is being learned', () => {
    expect(chooseExercise({ ...base, direction: 'recognition', state: 2 })).toBe('choose_meaning');
    expect(
      chooseExercise({
        ...base,
        direction: 'recognition',
        state: 2,
        hasImage: true,
        canChoosePicture: true,
      }),
    ).toBe('choose_picture');
    expect(chooseExercise({ ...base, direction: 'recall', state: 0 })).toBe('choose_word');
    expect(chooseExercise({ ...base, direction: 'recall', state: 1, stability: 0.5 })).toBe(
      'choose_word',
    );
  });

  it('asks to type (or fill in a sentence) once recall is established', () => {
    expect(chooseExercise({ ...base, direction: 'recall', state: 2, stability: 5 })).toBe(
      'type_word',
    );
    expect(
      chooseExercise({ ...base, direction: 'recall', state: 2, stability: 5, hasCloze: true }),
    ).toBe('cloze');
  });

  it('falls back when there are too few words for options', () => {
    const few = { ...base, canChooseText: false };
    expect(chooseExercise({ ...few, direction: 'recognition', state: 2 })).toBe('intro');
    expect(chooseExercise({ ...few, direction: 'recall', state: 1 })).toBe('type_word');
  });
});

describe('ratingFor', () => {
  it('maps results to ratings', () => {
    expect(ratingFor({ verdict: 'wrong', kind: 'choose_word' })).toBe('again');
    expect(ratingFor({ verdict: 'accents', kind: 'type_word' })).toBe('hard');
    expect(ratingFor({ verdict: 'correct', kind: 'cloze', hinted: true })).toBe('hard');
    expect(ratingFor({ verdict: 'correct', kind: 'choose_word', responseMs: 900 })).toBe('good');
    expect(ratingFor({ verdict: 'correct', kind: 'type_word', responseMs: 3000 })).toBe('easy');
    expect(
      ratingFor({ verdict: 'correct', kind: 'type_word', responseMs: 3000, isNew: true }),
    ).toBe('good');
    expect(ratingFor({ verdict: 'correct', kind: 'type_word', responseMs: 9000 })).toBe('good');
  });
});

describe('pickDrill', () => {
  const kot = {
    lemma: 'kot',
    lang: 'pl',
    forms: { gen_sg: 'kota', nom_pl: 'koty', ins_sg: 'kotem' },
  };

  it('asks for a form with a Polish sentence frame', () => {
    expect(pickDrill(kot, () => 0.9)).toEqual({
      formKey: 'ins_sg',
      label: 'instrumental singular',
      frame: { before: 'Idę z ', after: '.', translation: 'I’m going with …' },
      answer: 'kotem',
    });
  });

  it('prefers forms that differ from the dictionary form', () => {
    const woda = { lemma: 'woda', lang: 'pl', forms: { gen_sg: 'wody', nom_pl: 'woda' } };
    expect(pickDrill(woda, () => 0.99)?.formKey).toBe('gen_sg');
  });

  it('works without frames in other languages and skips unknown keys', () => {
    expect(
      pickDrill({ lemma: 'gato', lang: 'pt', forms: { pl: 'gatos', weird: 'x' } }, () => 0.5),
    ).toEqual({
      formKey: 'pl',
      label: 'plural',
      frame: null,
      answer: 'gatos',
    });
    expect(pickDrill({ lemma: 'x', lang: 'pl', forms: null })).toBeNull();
    expect(pickDrill({ lemma: 'x', lang: 'pl', forms: { weird: 'y' } })).toBeNull();
  });
});

describe('chooseExercise with drills', () => {
  it('includes drills among the established-recall exercises', () => {
    const ctx = {
      direction: 'recall' as const,
      state: 2,
      stability: 5,
      hasImage: false,
      canChoosePicture: false,
      canChooseText: true,
      hasCloze: true,
      hasDrill: true,
    };
    expect(chooseExercise({ ...ctx, rand: () => 0.1 })).toBe('cloze');
    expect(chooseExercise({ ...ctx, rand: () => 0.5 })).toBe('drill');
    expect(chooseExercise({ ...ctx, rand: () => 0.9 })).toBe('type_word');
    expect(ratingFor({ verdict: 'correct', kind: 'drill', responseMs: 2000 })).toBe('easy');
  });
});
