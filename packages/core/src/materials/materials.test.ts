import { describe, expect, it } from 'vitest';
import { parseGrammarNote, parseListeningScript } from './parse.ts';
import { buildGrammarPrompt, buildListeningPrompt } from './prompts.ts';

const base = {
  targetLang: 'pl',
  nativeLang: 'en',
  themeName: 'Owoce',
  words: [
    { lemma: 'jabłko', pos: 'noun', translation: 'apple', forms: { gen_sg: 'jabłka' } },
    { lemma: 'obierać', pos: 'verb', translation: 'to peel' },
  ],
};

describe('material prompts', () => {
  it('matches the listening snapshot', () => {
    expect(
      buildListeningPrompt({
        ...base,
        options: { style: 'dialogue', length: 'short', level: 'A2' },
      }),
    ).toMatchSnapshot();
  });

  it('describes stories and longer scripts', () => {
    const prompt = buildListeningPrompt({
      ...base,
      options: { style: 'story', length: 'medium', level: null },
    });
    expect(prompt).toContain('a short story or monologue told by one narrator (16 to 22 sentences');
  });

  it('matches the grammar snapshot, with forms and an optional focus', () => {
    const prompt = buildGrammarPrompt({ ...base, options: { focus: 'genitive', level: 'A2' } });
    expect(prompt).toContain('- jabłko (noun: apple; forms: gen_sg=jabłka)');
    expect(prompt).toContain('Topic: genitive.');
    expect(buildGrammarPrompt({ ...base, options: { level: null } })).toMatchSnapshot();
  });
});

describe('parseListeningScript', () => {
  const script = {
    title: 'Na targu',
    speakers: [
      { id: 'A', name: 'Ania' },
      { id: 'B', name: 'Tomek' },
    ],
    lines: [
      {
        speaker: 'A',
        text: 'Dzień dobry! Ile kosztują jabłka?',
        translation: 'Hello! How much are the apples?',
      },
      { speaker: 'Tomek', text: 'Pięć złotych za kilo.', translation: 'Five zloty a kilo.' },
    ],
    questions: [
      { question: 'What does Ania want?', options: ['Pears', 'Apples', 'Plums'], answer: 'B' },
      { question: 'How much?', options: ['5 zł', '10 zł'], answer: 2 },
      { question: 'Broken', options: ['x', 'y'], answer: 7 },
    ],
  };

  it('reads fenced JSON, maps speaker names and fixes answer formats', () => {
    const raw = `Here you go!\n\`\`\`json\n${JSON.stringify(script)}\n\`\`\``;
    const result = parseListeningScript(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.content.lines.map((l) => l.speaker)).toEqual(['A', 'B']);
    expect(result.content.questions.map((q) => q.answer)).toEqual([1, 1]);
  });

  it('accepts lines with unknown speakers and missing translations', () => {
    const result = parseListeningScript(
      JSON.stringify({
        title: 'Historia',
        lines: [
          { speaker: 'Narrator', text: 'Był sobie kot.' },
          { speaker: 'Narrator', text: 'Kot jadł.' },
        ],
      }),
    );
    expect(result.ok && result.content.speakers).toEqual([{ id: 'Narrator', name: 'Narrator' }]);
    expect(result.ok && result.content.lines[0]?.translation).toBeNull();
  });

  it('explains what is wrong', () => {
    expect(parseListeningScript('no json here')).toEqual({
      ok: false,
      error: 'No JSON found in the answer',
    });
    const result = parseListeningScript(JSON.stringify({ title: 'X', lines: [] }));
    expect(result.ok).toBe(false);
  });
});

describe('parseGrammarNote', () => {
  it('reads a note, dropping empty tables', () => {
    const result = parseGrammarNote(
      JSON.stringify({
        note: {
          title: 'The genitive',
          summary: 'After "nie ma".',
          sections: [
            {
              heading: 'Nie ma + genitive',
              explanation: 'Use the genitive after "nie ma".',
              examples: [{ text: 'Nie ma jabłka.', translation: 'There is no apple.' }],
              table: { headers: ['Nom', 'Gen'], rows: [] },
            },
          ],
          tips: ['Watch the ending.'],
        },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.content.sections[0]?.table).toBeNull();
    expect(result.content.sections[0]?.examples).toHaveLength(1);
  });

  it('rejects notes without sections', () => {
    expect(parseGrammarNote(JSON.stringify({ title: 'X', sections: [] })).ok).toBe(false);
  });
});
