import { type CefrLevel, languageName, type Scenario } from '@alivocab/shared';
import { extractJsonValue } from '../import/extract.ts';

export const ROLEPLAY_PROMPT_VERSION = 'roleplay@1';
export const SCENARIOS_PROMPT_VERSION = 'roleplay-scenarios@1';

type Words = ReadonlyArray<{ lemma: string; translation: string | null }>;

const wordList = (words: Words) =>
  words.map((w) => `${w.lemma}${w.translation ? ` (${w.translation})` : ''}`).join(', ');

export function buildScenariosPrompt(input: {
  targetLang: string;
  nativeLang: string;
  themeName: string;
  words: Words;
}): string {
  const target = languageName(input.targetLang);
  const native = languageName(input.nativeLang);
  return [
    `Suggest 3 short role-play scenarios for practising spoken ${target} on the theme "${input.themeName}", using words like: ${wordList(input.words)}.`,
    '',
    `Each is an everyday situation where the learner talks with one person (e.g. a shop assistant, a friend, a neighbour). Write "title", "description" (1–2 sentences: the situation and the learner's goal), "userRole" and "aiRole" in ${native}.`,
    '',
    'Output ONLY this JSON:',
    '```json',
    JSON.stringify(
      { scenarios: [{ title: '<…>', description: '<…>', userRole: '<…>', aiRole: '<…>' }] },
      null,
      2,
    ),
    '```',
  ].join('\n');
}

/** The scenarios in an AI answer (any reasonable JSON shape), or an empty list. */
export function parseScenarios(raw: string): unknown[] {
  const value = extractJsonValue(raw);
  if (Array.isArray(value)) return value;
  if (
    value &&
    typeof value === 'object' &&
    Array.isArray((value as { scenarios?: unknown }).scenarios)
  ) {
    return (value as { scenarios: unknown[] }).scenarios;
  }
  return [];
}

/**
 * The partner's instructions. Each answer uses tags so it can be shown while it streams:
 * <correction> (of the learner's last message, or OK), <explanation>, <reply>, <translation>.
 */
export function buildRoleplaySystem(input: {
  targetLang: string;
  nativeLang: string;
  scenario: Scenario;
  level: CefrLevel | null;
  words: Words;
}): string {
  const target = languageName(input.targetLang);
  const native = languageName(input.nativeLang);
  const level = input.level ?? 'A2';
  return [
    `You are a friendly conversation partner helping someone practise ${target} (level ${level}; their native language is ${native}).`,
    '',
    `Scenario: ${input.scenario.title}. ${input.scenario.description}`,
    `You play: ${input.scenario.aiRole}. The learner plays: ${input.scenario.userRole}.`,
    `Words the learner is practising (use them naturally when they fit): ${wordList(input.words)}.`,
    '',
    'How to talk:',
    `- Speak only ${target} in your reply, at level ${level}: short sentences, common words. 1–3 sentences per turn, then let the learner answer (often with a question).`,
    '- Stay in role and keep the scenario going; bring it to a natural end after about 10–15 turns.',
    `- If the learner writes in ${native} or gets stuck, answer in simple ${target} and show the words they could use.`,
    '',
    'Every answer has exactly these parts, in this order, and nothing else:',
    `<correction>The learner's last message corrected with as few changes as possible, or OK if it was right (or if there was no message yet).</correction>`,
    `<explanation>One short ${native} sentence about the main mistake; empty if the correction is OK.</explanation>`,
    `<reply>Your reply in ${target}.</reply>`,
    `<translation>Your reply in ${native}.</translation>`,
  ].join('\n');
}

/** Asks the partner to open the conversation (sent as the first user turn). */
export const ROLEPLAY_OPENER = '(Start the conversation in your role.)';

export type RoleplayTurn = {
  /** Null while unknown or when the learner's message was right (OK). */
  corrected: string | null;
  explanation: string | null;
  reply: string;
  translation: string | null;
  /** The reply has started (show it while streaming). */
  replyStarted: boolean;
  /** Set when the turn failed (the server ends the stream with `<stream-error>`). */
  error: string | null;
};

/** The text inside `<tag>…</tag>`, or what has arrived so far if it isn't closed yet. */
function tagText(text: string, tag: string): { value: string; open: boolean } | null {
  const start = text.indexOf(`<${tag}>`);
  if (start < 0) return null;
  const from = start + tag.length + 2;
  const end = text.indexOf(`</${tag}>`, from);
  // Don't show a half-received closing or next tag.
  const value = end < 0 ? text.slice(from).replace(/<\/?[a-z]*$/i, '') : text.slice(from, end);
  return { value: value.trim(), open: end < 0 };
}

/**
 * Reads a partner answer, complete or still streaming. Models that ignore the tags still work:
 * their whole answer is taken as the reply.
 */
export function parseRoleplayTurn(input: string): RoleplayTurn {
  // `<stream-error>` is STREAM_ERROR_TAG from @alivocab/ai, appended when the turn failed.
  const failure = tagText(input, 'stream-error');
  const at = input.indexOf('<stream-error>');
  const text = at < 0 ? input : input.slice(0, at);
  const correction = tagText(text, 'correction');
  const explanation = tagText(text, 'explanation');
  const reply = tagText(text, 'reply');
  const translation = tagText(text, 'translation');
  const hasTags = !!(correction || reply);
  const ok = !correction || /^ok\.?$/i.test(correction.value) || !correction.value;
  return {
    corrected: ok || correction?.open ? null : (correction?.value ?? null),
    explanation: ok ? null : explanation?.value || null,
    reply: hasTags ? (reply?.value ?? '') : text.replace(/<[^>]*>/g, '').trim(),
    translation: translation?.value || null,
    replyStarted: hasTags ? !!reply : !!text.trim(),
    error: failure ? failure.value || 'The partner didn’t answer.' : null,
  };
}
