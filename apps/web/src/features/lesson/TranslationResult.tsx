import type { TranslationCheck } from '@alivocab/core';
import type { LessonItemDto, TranslationFeedback } from '@alivocab/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, CircleAlert, Loader2, Sparkles, X } from 'lucide-react';
import { SpeakButton } from '@/features/themes/SpeakButton';
import { api, errorMessage, unwrap } from '@/lib/api';
import { credentialsQuery } from '@/lib/queries';
import { cn } from '@/lib/utils';

const FREE: Record<TranslationCheck, { label: string; tone: 'ok' | 'almost' | 'unsure' }> = {
  match: { label: 'Correct', tone: 'ok' },
  accents: { label: 'Almost: check the accents', tone: 'almost' },
  close: { label: 'Close: one word differs from the stored translation', tone: 'almost' },
  different: { label: 'Different from the stored translation', tone: 'unsure' },
};

const AI_VERDICT: Record<
  TranslationFeedback['verdict'],
  { label: string; tone: 'ok' | 'almost' | 'bad' }
> = {
  correct: { label: 'AI: your translation is right', tone: 'ok' },
  acceptable: { label: 'AI: understandable, with small issues', tone: 'almost' },
  wrong: { label: 'AI: not quite right', tone: 'bad' },
};

const PANEL = {
  ok: 'border-correct/40 bg-correct/10',
  almost: 'border-status-recognize/40 bg-status-recognize/10',
  unsure: 'border-border bg-muted/40',
  bad: 'border-incorrect/40 bg-incorrect/10',
};
const ICON = { ok: Check, almost: CircleAlert, unsure: CircleAlert, bad: X };
const TEXT = {
  ok: 'text-correct',
  almost: 'text-status-recognize',
  unsure: 'text-muted-foreground',
  bad: 'text-incorrect',
};

/**
 * Result of a translation: the free comparison with the stored translation and, when it isn't a
 * clear match, an "Ask AI" check that explains whether the learner's version is also right.
 */
export function TranslationResult({
  item,
  given,
  check,
}: {
  item: LessonItemDto;
  given: string;
  check: TranslationCheck;
}) {
  const { data: credentials } = useQuery(credentialsQuery);
  const t = item.translate;
  const ask = useMutation({
    mutationFn: () =>
      unwrap(
        api.lessons['check-translation'].$post({
          json: {
            source: t?.source ?? '',
            reference: t?.reference ?? '',
            answer: given,
            lang: item.card.lang,
            nativeLang: item.card.nativeLang,
          },
        }),
      ),
  });
  if (!t) return null;
  const free = FREE[check];
  const FreeIcon = ICON[free.tone];
  const ai = ask.data ? AI_VERDICT[ask.data.verdict] : null;
  const AiIcon = ai ? ICON[ai.tone] : null;

  return (
    <div className="space-y-3">
      <div role="status" className={cn('space-y-2 rounded-xl border p-4', PANEL[free.tone])}>
        <p className={cn('flex items-center gap-1.5 font-semibold', TEXT[free.tone])}>
          <FreeIcon className="size-5" aria-hidden /> {free.label}
        </p>
        {check !== 'match' && (
          <p className="flex items-start gap-1">
            <SpeakButton text={t.reference} lang={item.card.lang} />
            <span>
              <span className="text-sm text-muted-foreground">Stored translation: </span>
              <strong lang={item.card.lang}>{t.reference}</strong>
            </span>
          </p>
        )}
        {check === 'different' && !ask.data && (
          <p className="text-sm text-muted-foreground">
            Your version may still be right (other word order or words).
          </p>
        )}
      </div>

      {check !== 'match' && !ask.data && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
            disabled={ask.isPending || !credentials?.length}
            onClick={() => ask.mutate()}
          >
            {ask.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            Ask AI if mine is right
          </button>
          {!credentials?.length && (
            <span className="text-xs text-muted-foreground">Needs an API key in Settings.</span>
          )}
          {ask.error && <span className="text-sm text-incorrect">{errorMessage(ask.error)}</span>}
        </div>
      )}

      {ask.data && ai && AiIcon && (
        <div className={cn('space-y-2 rounded-xl border p-4', PANEL[ai.tone])}>
          <p className={cn('flex items-center gap-1.5 font-semibold', TEXT[ai.tone])}>
            <AiIcon className="size-5" aria-hidden /> {ai.label}
          </p>
          {ask.data.verdict !== 'correct' && (
            <p>
              <span className="text-sm text-muted-foreground">Corrected: </span>
              <strong lang={item.card.lang}>{ask.data.corrected}</strong>
            </p>
          )}
          <p className="text-sm">{ask.data.explanation}</p>
          {ask.data.mistakes.length > 0 && (
            <ul className="space-y-1 text-sm">
              {ask.data.mistakes.map((m) => (
                <li key={`${m.wrong}-${m.right}`}>
                  <span className="line-through decoration-incorrect" lang={item.card.lang}>
                    {m.wrong}
                  </span>{' '}
                  → <strong lang={item.card.lang}>{m.right}</strong>
                  <span className="text-muted-foreground"> · {m.note}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
