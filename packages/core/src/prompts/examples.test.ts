import { describe, expect, it } from 'vitest';
import { parseVocabulary } from '../import/parse.ts';
import { buildExamplesPrompt } from './examples.ts';

describe('buildExamplesPrompt', () => {
  it('matches the snapshot', () => {
    expect(
      buildExamplesPrompt({
        targetLang: 'pl',
        nativeLang: 'en',
        themeName: 'Owoce',
        words: [
          { lemma: 'jabłko', pos: 'noun', translation: 'apple' },
          { lemma: 'obierać', pos: 'verb', translation: 'to peel' },
        ],
      }),
    ).toMatchSnapshot();
  });

  it('produces answers the vocabulary parser reads, with the cloze form', () => {
    const answer = JSON.stringify([
      {
        lemma: 'jabłko',
        pos: 'noun',
        translation: 'apple',
        example: 'Nie mam jabłka.',
        example_translation: 'I don’t have an apple.',
        cloze: 'jabłka',
      },
      {
        lemma: 'jabłko',
        pos: 'noun',
        translation: 'apple',
        example: 'To jabłko jest słodkie.',
        example_translation: 'This apple is sweet.',
        cloze: 'jabłko',
      },
    ]);
    const { words } = parseVocabulary(answer, { lang: 'pl', nativeLang: 'en' });
    expect(words).toHaveLength(1);
    expect(words[0]?.examples).toEqual([
      { text: 'Nie mam jabłka.', translation: 'I don’t have an apple.', cloze: 'jabłka' },
      { text: 'To jabłko jest słodkie.', translation: 'This apple is sweet.', cloze: 'jabłko' },
    ]);
  });
});
