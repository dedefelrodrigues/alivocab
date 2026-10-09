import { describe, expect, it } from 'vitest';
import { parseVocabulary } from '../import/parse.ts';
import { buildFormsPrompt } from './forms.ts';

describe('buildFormsPrompt', () => {
  it('matches the snapshot', () => {
    expect(
      buildFormsPrompt({
        targetLang: 'pl',
        nativeLang: 'en',
        words: [
          { lemma: 'kot', pos: 'noun', translation: 'cat' },
          { lemma: 'obierać', pos: 'verb', translation: 'to peel' },
        ],
      }),
    ).toMatchSnapshot();
  });

  it('produces answers the vocabulary parser reads', () => {
    const answer = JSON.stringify([
      { lemma: 'kot', pos: 'noun', translation: 'cat', forms: { gen_sg: 'kota', ins_sg: 'kotem' } },
    ]);
    expect(parseVocabulary(answer, { lang: 'pl', nativeLang: 'en' }).words[0]?.forms).toEqual({
      gen_sg: 'kota',
      ins_sg: 'kotem',
    });
  });
});
