import { describe, expect, it } from 'vitest';
import { buildVocabPrompt } from './vocabProposal.ts';

const base = {
  targetLang: 'pl',
  nativeLang: 'en',
  themeName: 'At the bakery',
  count: 30,
  level: 'A2' as const,
  format: 'json' as const,
};

describe('buildVocabPrompt', () => {
  it('matches the Polish JSON snapshot', () => {
    expect(
      buildVocabPrompt({ ...base, description: 'Buying bread and pastries' }),
    ).toMatchSnapshot();
  });

  it('matches the CSV snapshot', () => {
    expect(buildVocabPrompt({ ...base, format: 'csv' })).toMatchSnapshot();
  });

  it('includes the avoid list and count', () => {
    const prompt = buildVocabPrompt({ ...base, count: 25, avoid: ['chleb', 'bułka'] });
    expect(prompt).toContain('Exactly 25 distinct items');
    expect(prompt).toContain('Do NOT include any of these (already known): chleb, bułka.');
  });

  it('only asks for aspect in languages that have it', () => {
    expect(buildVocabPrompt(base)).toContain('"aspect"');
    expect(buildVocabPrompt({ ...base, targetLang: 'pt', nativeLang: 'en' })).not.toContain(
      'aspect',
    );
  });

  it('names both languages and falls back for unknown levels', () => {
    const prompt = buildVocabPrompt({ ...base, targetLang: 'es', nativeLang: 'pt', level: null });
    expect(prompt).toContain(
      'Spanish vocabulary items for a learner whose native language is Portuguese',
    );
    expect(prompt).toContain('a mix of everyday');
  });
});
