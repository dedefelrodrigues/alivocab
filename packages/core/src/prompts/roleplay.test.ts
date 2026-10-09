import { describe, expect, it } from 'vitest';
import { buildRoleplaySystem, parseRoleplayTurn, parseScenarios } from './roleplay.ts';

describe('role-play', () => {
  it('matches the system prompt snapshot', () => {
    expect(
      buildRoleplaySystem({
        targetLang: 'pl',
        nativeLang: 'en',
        level: 'A2',
        scenario: {
          title: 'At the bakery',
          description: 'Buy bread for a party.',
          userRole: 'a customer',
          aiRole: 'the baker',
        },
        words: [
          { lemma: 'chleb', translation: 'bread' },
          { lemma: 'bułka', translation: null },
        ],
      }),
    ).toMatchSnapshot();
  });

  it('reads a complete turn with a correction', () => {
    const turn = parseRoleplayTurn(
      '<correction>Poproszę dwa chleby.</correction>\n<explanation>"Chleb" takes the plural "chleby" after "dwa".</explanation>\n<reply>Proszę bardzo. Coś jeszcze?</reply>\n<translation>Here you are. Anything else?</translation>',
    );
    expect(turn).toEqual({
      corrected: 'Poproszę dwa chleby.',
      explanation: '"Chleb" takes the plural "chleby" after "dwa".',
      reply: 'Proszę bardzo. Coś jeszcze?',
      translation: 'Here you are. Anything else?',
      replyStarted: true,
      error: null,
    });
  });

  it('treats OK as no correction', () => {
    const turn = parseRoleplayTurn(
      '<correction>OK</correction><explanation></explanation><reply>Dzień dobry!</reply>',
    );
    expect(turn).toMatchObject({ corrected: null, explanation: null, reply: 'Dzień dobry!' });
  });

  it('shows a streaming reply without half-received tags', () => {
    expect(parseRoleplayTurn('<correction>OK</correction><reply>Dzień dob')).toMatchObject({
      reply: 'Dzień dob',
      replyStarted: true,
    });
    expect(parseRoleplayTurn('<correction>OK</correction><reply>Dzień dobry!</re').reply).toBe(
      'Dzień dobry!',
    );
    expect(parseRoleplayTurn('<correction>Popro').replyStarted).toBe(false);
  });

  it('uses the whole answer when a model ignores the tags', () => {
    expect(parseRoleplayTurn('Dzień dobry! W czym mogę pomóc?')).toMatchObject({
      reply: 'Dzień dobry! W czym mogę pomóc?',
      corrected: null,
      replyStarted: true,
    });
  });

  it('reports a failed turn without mistaking the error for a reply', () => {
    const failed = parseRoleplayTurn(
      '<correction>OK</correction><reply>Dzień</reply>\n<stream-error>The provider is rate-limiting requests.</stream-error>',
    );
    expect(failed).toMatchObject({
      reply: 'Dzień',
      error: 'The provider is rate-limiting requests.',
    });
    expect(parseRoleplayTurn('\n<stream-error>Timed out</stream-error>')).toMatchObject({
      reply: '',
      replyStarted: false,
      error: 'Timed out',
    });
  });

  it('finds scenarios in an answer', () => {
    expect(parseScenarios('```json\n{"scenarios":[{"title":"A"}]}\n```')).toEqual([{ title: 'A' }]);
    expect(parseScenarios('[{"title":"B"}]')).toEqual([{ title: 'B' }]);
    expect(parseScenarios('nothing')).toEqual([]);
  });
});
