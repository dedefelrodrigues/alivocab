import type { ReviewCardDto, ReviewRatingName } from '@alivocab/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowLeft, PartyPopper, Volume2, VolumeX } from 'lucide-react';
import { type TouchEvent, useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Flashcard } from '@/features/review/Flashcard';
import { RATING_KEYS, RatingBar } from '@/features/review/RatingBar';
import { speak } from '@/hooks/useVoices';
import { api, errorMessage, unwrap } from '@/lib/api';
import { meQuery, reviewQueueQuery, themeQuery } from '@/lib/queries';

export const Route = createFileRoute('/_app/review')({
  validateSearch: z.object({ themeId: z.string().optional() }),
  component: ReviewPage,
});

const AUTOPLAY_KEY = 'alivocab.review.autoplay';

function readAutoplay(): boolean {
  try {
    return localStorage.getItem(AUTOPLAY_KEY) !== 'false';
  } catch {
    return true;
  }
}

/** Cards that come back in this session are reinserted a few cards later. */
const REQUEUE_GAP = 3;

function ReviewPage() {
  const { themeId } = Route.useSearch();
  const [session, setSession] = useState(0);
  const { data, isPending, error } = useQuery(reviewQueueQuery(themeId, session));
  const { data: theme } = useQuery({ ...themeQuery(themeId ?? ''), enabled: !!themeId });

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="icon" aria-label="Back">
          {themeId ? (
            <Link to="/themes/$themeId" params={{ themeId }}>
              <ArrowLeft />
            </Link>
          ) : (
            <Link to="/">
              <ArrowLeft />
            </Link>
          )}
        </Button>
        <h1 className="flex-1 truncate text-xl font-bold tracking-tight">
          Review{theme ? `: ${theme.name}` : ''}
        </h1>
      </div>
      {isPending ? (
        <Skeleton className="h-80 w-full rounded-2xl" />
      ) : error || !data ? (
        <p className="text-center text-incorrect">
          Could not load your reviews: {errorMessage(error)}
        </p>
      ) : (
        <Session
          key={session}
          initial={data.cards}
          themeId={themeId}
          onRestart={() => setSession((s) => s + 1)}
        />
      )}
    </div>
  );
}

function Session({
  initial,
  themeId,
  onRestart,
}: {
  initial: ReviewCardDto[];
  themeId?: string;
  onRestart: () => void;
}) {
  const queryClient = useQueryClient();
  const { data: me } = useQuery(meQuery);
  const [queue, setQueue] = useState(initial);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [autoplay, setAutoplay] = useState(readAutoplay);
  const [stats, setStats] = useState({ reviewed: 0, again: 0 });
  const shownAt = useRef(Date.now());
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const card = queue[index];
  const done = !card;

  // Latest position, so a late server response still inserts relative to where the learner is.
  const indexRef = useRef(index);
  indexRef.current = index;

  const grade = useMutation({
    mutationFn: ({
      cardId,
      rating,
      responseMs,
    }: {
      cardId: string;
      rating: ReviewRatingName;
      responseMs: number;
    }) =>
      unwrap(
        api.review.cards[':cardId'].$post({ param: { cardId }, json: { rating, responseMs } }),
      ),
    onSuccess: (result, vars) => {
      const again = result.requeue;
      if (!again) return;
      setQueue((q) => {
        // "Again" comes back a few cards later; other learning steps wait until the end.
        const at =
          vars.rating === 'again' ? Math.min(q.length, indexRef.current + REQUEUE_GAP) : q.length;
        return [...q.slice(0, at), again, ...q.slice(at)];
      });
    },
    onError: (err, vars) => {
      toast.error(`Not saved: ${errorMessage(err)}`);
      // Put the card back at the end so the answer isn't lost.
      setQueue((q) => {
        const original = q.find((c) => c.cardId === vars.cardId);
        return original ? [...q, original] : q;
      });
    },
  });

  // Speak the target-language side when it becomes visible.
  useEffect(() => {
    if (!card || !autoplay) return;
    const targetVisible = card.direction === 'recognition' ? !revealed : revealed;
    if (targetVisible) speak(card.lemma, card.lang, me?.profile.ttsVoice);
  }, [card, revealed, autoplay, me?.profile.ttsVoice]);

  useEffect(() => {
    if (done) {
      void queryClient.invalidateQueries({ queryKey: ['review', 'summary'] });
      void queryClient.invalidateQueries({ queryKey: ['themes'] });
    }
  }, [done, queryClient]);

  const rate = useCallback(
    (rating: ReviewRatingName) => {
      if (!card) return;
      grade.mutate({ cardId: card.cardId, rating, responseMs: Date.now() - shownAt.current });
      setStats((s) => ({
        reviewed: s.reviewed + 1,
        again: s.again + (rating === 'again' ? 1 : 0),
      }));
      setRevealed(false);
      setIndex((i) => i + 1);
      shownAt.current = Date.now();
    },
    [card, grade],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!card || e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.target as HTMLElement | null)?.closest('input, textarea, select')) return;
      if (!revealed && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        setRevealed(true);
      } else if (revealed && RATING_KEYS[e.key]) {
        e.preventDefault();
        rate(RATING_KEYS[e.key] as ReviewRatingName);
      } else if (revealed && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        rate('good');
      } else if (e.key === 'p') {
        speak(card.lemma, card.lang, me?.profile.ttsVoice);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [card, revealed, rate, me?.profile.ttsVoice]);

  // Swipe after revealing: right = good, left = again.
  const onTouchStart = (e: TouchEvent) => {
    const t = e.touches[0];
    if (t) touchStart.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e: TouchEvent) => {
    const start = touchStart.current;
    const t = e.changedTouches[0];
    touchStart.current = null;
    if (!start || !t || !revealed) return;
    const dx = t.clientX - start.x;
    if (Math.abs(dx) > 80 && Math.abs(dx) > 2 * Math.abs(t.clientY - start.y))
      rate(dx > 0 ? 'good' : 'again');
  };

  const toggleAutoplay = () => {
    setAutoplay((on) => {
      try {
        localStorage.setItem(AUTOPLAY_KEY, String(!on));
      } catch {
        // Not persisted in private mode; the toggle still works for this session.
      }
      return !on;
    });
  };

  if (done) {
    return stats.reviewed === 0 ? (
      <div className="grid place-items-center gap-3 rounded-2xl border border-dashed p-10 text-center">
        <PartyPopper className="size-8 text-primary" />
        <p className="font-medium">Nothing to review right now</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          All caught up. Come back later, or add new words to a theme.
        </p>
        <Button asChild variant="outline">
          <Link to={themeId ? '/themes/$themeId' : '/themes'} params={{ themeId: themeId ?? '' }}>
            Go to themes
          </Link>
        </Button>
      </div>
    ) : (
      <div className="grid place-items-center gap-3 rounded-2xl border p-10 text-center">
        <PartyPopper className="size-8 text-primary" />
        <p className="text-lg font-semibold">Session done. Dobra robota!</p>
        <p className="text-sm text-muted-foreground">
          {stats.reviewed} review{stats.reviewed === 1 ? '' : 's'} ·{' '}
          {Math.round(((stats.reviewed - stats.again) / stats.reviewed) * 100)}% remembered
        </p>
        <div className="flex gap-2">
          <Button onClick={onRestart}>Check for more</Button>
          <Button asChild variant="outline">
            <Link to="/">Home</Link>
          </Button>
        </div>
      </div>
    );
  }

  const progress = (index / queue.length) * 100;

  return (
    <div className="space-y-4" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <div className="flex items-center gap-3">
        <div
          className="h-2 flex-1 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={queue.length}
          aria-valuenow={index}
          aria-label="Session progress"
        >
          <div
            className="h-full bg-primary motion-safe:transition-[width]"
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="text-sm text-muted-foreground tabular-nums">
          {index}/{queue.length}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-pressed={autoplay}
          aria-label={
            autoplay ? 'Turn off automatic pronunciation' : 'Turn on automatic pronunciation'
          }
          onClick={toggleAutoplay}
        >
          {autoplay ? <Volume2 /> : <VolumeX />}
        </Button>
      </div>

      {card.isNew && (
        <p className="text-center text-xs font-medium uppercase tracking-wide text-primary">
          {card.direction === 'recognition' ? 'New word' : 'New: now the other way round'}
        </p>
      )}

      <Flashcard card={card} revealed={revealed} onReveal={() => setRevealed(true)} />

      {revealed ? (
        <RatingBar intervals={card.intervals} onRate={rate} />
      ) : (
        <Button className="h-12 w-full text-base" onClick={() => setRevealed(true)}>
          Show answer <span className="hidden text-xs opacity-70 sm:inline">(Space)</span>
        </Button>
      )}
      <p className="text-center text-xs text-muted-foreground">
        <span className="sm:hidden">
          After revealing, swipe right for “Good” or left for “Again”.
        </span>
        <span className="hidden sm:inline">Keys: Space to reveal, 1–4 to rate, P to hear it.</span>
      </p>
    </div>
  );
}
