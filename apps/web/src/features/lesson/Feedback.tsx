import type { AnswerVerdict } from '@alivocab/core';
import type { ReviewCardDto } from '@alivocab/shared';
import { Check, CircleAlert, X } from 'lucide-react';
import { SpeakButton } from '@/features/themes/SpeakButton';
import { WordMeta } from '@/features/themes/WordMeta';
import { cn } from '@/lib/utils';

const VERDICTS: Record<
  AnswerVerdict,
  { label: string; icon: typeof Check; className: string; panel: string }
> = {
  correct: {
    label: 'Correct',
    icon: Check,
    className: 'text-correct',
    panel: 'border-correct/40 bg-correct/10',
  },
  accents: {
    label: 'Almost: check the accents',
    icon: CircleAlert,
    className: 'text-status-recognize',
    panel: 'border-status-recognize/40 bg-status-recognize/10',
  },
  typo: {
    label: 'Almost: a small typo',
    icon: CircleAlert,
    className: 'text-status-recognize',
    panel: 'border-status-recognize/40 bg-status-recognize/10',
  },
  wrong: {
    label: 'Not quite',
    icon: X,
    className: 'text-incorrect',
    panel: 'border-incorrect/40 bg-incorrect/10',
  },
};

/**
 * Marks the letters of `expected` that differ from what was typed (same length only, which is
 * the case for missing accents), so the learner sees exactly which ones were off.
 */
function Diff({ given, expected, lang }: { given: string; expected: string; lang: string }) {
  const a = [...given.trim()];
  const b = [...expected];
  if (a.length !== b.length) return <span lang={lang}>{expected}</span>;
  // Positions are stable for a fixed string, so they make fine keys.
  const segments = b.map((ch, pos) => ({
    id: `c${pos}`,
    ch,
    off: ch.toLocaleLowerCase(lang) !== a[pos]?.toLocaleLowerCase(lang),
  }));
  return (
    <span lang={lang}>
      {segments.map((seg) =>
        seg.off ? (
          <mark
            key={seg.id}
            className="rounded-sm bg-status-recognize/30 px-px text-foreground underline"
          >
            {seg.ch}
          </mark>
        ) : (
          <span key={seg.id}>{seg.ch}</span>
        ),
      )}
    </span>
  );
}

/** Result of an answer, with the word's details so every answer teaches something. */
export function Feedback({
  verdict,
  card,
  given,
  expected,
}: {
  verdict: AnswerVerdict;
  card: ReviewCardDto;
  /** What was typed (typed exercises). */
  given?: string;
  /** The right answer as it should have been typed. */
  expected?: string;
}) {
  const v = VERDICTS[verdict];
  const Icon = v.icon;
  return (
    <div role="status" className={cn('space-y-2 rounded-xl border p-4', v.panel)}>
      <p className={cn('flex items-center gap-1.5 font-semibold', v.className)}>
        <Icon className="size-5" aria-hidden /> {v.label}
      </p>
      {expected && verdict !== 'correct' && (
        <p className="text-lg">
          {verdict === 'wrong' ? 'The answer is ' : 'It’s spelled '}
          <strong>
            {verdict === 'accents' && given ? (
              <Diff given={given} expected={expected} lang={card.lang} />
            ) : (
              <span lang={card.lang}>{expected}</span>
            )}
          </strong>
        </p>
      )}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-xl font-semibold" lang={card.lang}>
          {card.lemma}
        </span>
        <SpeakButton text={card.lemma} lang={card.lang} />
        <span className="text-muted-foreground">{card.translations.join(', ')}</span>
        <span className="text-sm text-muted-foreground">
          <WordMeta pos={card.pos} gender={card.gender} aspect={card.aspect} />
        </span>
      </div>
      {card.mnemonic && <p className="text-sm">💡 {card.mnemonic}</p>}
    </div>
  );
}
