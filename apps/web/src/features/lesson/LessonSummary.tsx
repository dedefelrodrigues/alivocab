import type { ReviewCardDto, WordStatus } from '@alivocab/shared';
import { Link } from '@tanstack/react-router';
import { ArrowUp, PartyPopper } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SpeakButton } from '@/features/themes/SpeakButton';
import { STATUS_META } from '@/features/themes/status';
import { cn } from '@/lib/utils';

export type LessonStats = {
  exercises: number;
  /** Per card: answered right the first time it came up. */
  firstTry: Map<string, boolean>;
  /** Words answered wrong at least once. */
  missed: Map<string, ReviewCardDto>;
  /** Words whose status went up during the lesson. */
  raised: Map<string, { card: ReviewCardDto; to: WordStatus }>;
  startedAt: number;
};

export const emptyStats = (): LessonStats => ({
  exercises: 0,
  firstTry: new Map(),
  missed: new Map(),
  raised: new Map(),
  startedAt: Date.now(),
});

function duration(ms: number) {
  const s = Math.max(1, Math.round(ms / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
}

/** End of a lesson: how it went, words that moved up, and words worth another look. */
export function LessonSummary({
  stats,
  graded,
  remaining,
  onNext,
  onPractice,
}: {
  stats: LessonStats;
  graded: boolean;
  remaining: number;
  onNext: () => void;
  onPractice: () => void;
}) {
  const tried = [...stats.firstTry.values()];
  const right = tried.filter(Boolean).length;
  const percent = tried.length ? Math.round((right / tried.length) * 100) : 0;
  return (
    <div className="space-y-6">
      <div className="grid place-items-center gap-2 rounded-2xl border p-8 text-center">
        <PartyPopper className="size-8 text-primary" />
        <p className="text-lg font-semibold">Lesson done. Dobra robota!</p>
        <p className="text-sm text-muted-foreground">
          {stats.exercises} exercise{stats.exercises === 1 ? '' : 's'} · {percent}% right the first
          time · {duration(Date.now() - stats.startedAt)}
        </p>
        {!graded && (
          <p className="text-xs text-muted-foreground">
            Extra practice doesn’t change when words are due.
          </p>
        )}
      </div>

      {stats.raised.size > 0 && (
        <section className="space-y-2">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">
            <ArrowUp className="size-4 text-correct" aria-hidden /> Moved up
          </h2>
          <ul className="divide-y rounded-xl border">
            {[...stats.raised.values()].map(({ card, to }) => {
              const meta = STATUS_META[to];
              const Icon = meta.icon;
              return (
                <li key={card.lexemeId} className="flex items-center gap-2 px-3 py-2">
                  <span className="font-medium" lang={card.lang}>
                    {card.lemma}
                  </span>
                  <span className="flex-1 truncate text-sm text-muted-foreground">
                    {card.translations.join(', ')}
                  </span>
                  <span className={cn('flex items-center gap-1 text-sm', meta.text)}>
                    <Icon className="size-4" aria-hidden /> {meta.label}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {stats.missed.size > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Worth another look</h2>
          <ul className="divide-y rounded-xl border">
            {[...stats.missed.values()].map((card) => (
              <li key={card.lexemeId} className="flex items-center gap-2 px-3 py-2">
                <span className="font-medium" lang={card.lang}>
                  {card.lemma}
                </span>
                <SpeakButton text={card.lemma} lang={card.lang} />
                <span className="flex-1 truncate text-sm text-muted-foreground">
                  {card.translations.join(', ')}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex flex-wrap justify-center gap-2">
        {graded && remaining > 0 ? (
          <Button onClick={onNext}>Next lesson ({remaining} left)</Button>
        ) : (
          <Button onClick={onPractice}>Practice more</Button>
        )}
        <Button asChild variant="outline">
          <Link to="/">Home</Link>
        </Button>
      </div>
    </div>
  );
}
