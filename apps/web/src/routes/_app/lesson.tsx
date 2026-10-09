import {
  type AnswerVerdict,
  acceptedAnswers,
  checkAnswer,
  checkTranslation,
  exerciseTypeOf,
  ratingFor,
  scrambleCorrect,
  shuffle,
  type TranslationCheck,
} from '@alivocab/core';
import {
  type GradeResultDto,
  LESSON_MODES,
  type LessonItemDto,
  type LessonMode,
  type ReviewRatingName,
  type WordStatus,
} from '@alivocab/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Dumbbell, PartyPopper } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ChoiceExercise } from '@/features/lesson/ChoiceExercise';
import { Feedback } from '@/features/lesson/Feedback';
import { emptyStats, type LessonStats, LessonSummary } from '@/features/lesson/LessonSummary';
import { SentenceExercise } from '@/features/lesson/SentenceExercise';
import { TranslationResult } from '@/features/lesson/TranslationResult';
import { expectedAnswer, TypeExercise } from '@/features/lesson/TypeExercise';
import { Flashcard } from '@/features/review/Flashcard';
import { RATING_KEYS, RatingBar } from '@/features/review/RatingBar';
import { speak } from '@/hooks/useVoices';
import { api, errorMessage, unwrap } from '@/lib/api';
import { lessonQuery, meQuery, themeQuery } from '@/lib/queries';

export const Route = createFileRoute('/_app/lesson')({
  validateSearch: z.object({
    themeId: z.string().optional(),
    mode: z.enum(LESSON_MODES).optional(),
  }),
  component: LessonPage,
});

/** Missed exercises come back this many exercises later. */
const REPEAT_GAP = 3;
const STATUS_RANK: Record<WordStatus, number> = { untagged: 0, unknown: 1, recognize: 2, known: 3 };

function readAutoplay(): boolean {
  try {
    return localStorage.getItem('alivocab.review.autoplay') !== 'false';
  } catch {
    return true;
  }
}

function LessonPage() {
  const { themeId, mode = 'due' } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const [session, setSession] = useState(0);
  const { data, isPending, error } = useQuery(lessonQuery(themeId, mode, session));
  const { data: theme } = useQuery({ ...themeQuery(themeId ?? ''), enabled: !!themeId });

  const start = (next: LessonMode) => {
    if (next !== mode) void navigate({ search: (s) => ({ ...s, mode: next }) });
    setSession((s) => s + 1);
  };

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
          {
            { due: 'Lesson', practice: 'Practice', drill: 'Grammar drill', translate: 'Translate' }[
              mode
            ]
          }
          {theme ? `: ${theme.name}` : ''}
        </h1>
      </div>
      {isPending ? (
        <Skeleton className="h-80 w-full rounded-2xl" />
      ) : error || !data ? (
        <p className="text-center text-incorrect">
          Could not load the lesson: {errorMessage(error)}
        </p>
      ) : data.items.length === 0 ? (
        <Empty mode={mode} themeId={themeId} onPractice={() => start('practice')} />
      ) : (
        <Session
          key={`${mode}-${session}`}
          initial={data.items}
          mode={mode}
          remaining={data.remaining}
          onNext={() => start('due')}
          onPractice={() => start('practice')}
        />
      )}
    </div>
  );
}

function Empty({
  mode,
  themeId,
  onPractice,
}: {
  mode: LessonMode;
  themeId?: string;
  onPractice: () => void;
}) {
  return (
    <div className="grid place-items-center gap-3 rounded-2xl border border-dashed p-10 text-center">
      <PartyPopper className="size-8 text-primary" />
      {mode === 'due' ? (
        <>
          <p className="font-medium">Nothing due right now</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            You can still practice your weakest words. It won’t change when they’re due.
          </p>
          <Button onClick={onPractice}>
            <Dumbbell /> Practice anyway
          </Button>
        </>
      ) : (
        <>
          <p className="font-medium">
            {mode === 'drill' ? 'No words to drill yet' : 'No words to practice yet'}
          </p>
          <p className="max-w-sm text-sm text-muted-foreground">
            {mode === 'drill'
              ? 'Drills use grammatical forms of words you’ve already seen. Words without forms can get them from the theme menu (Add grammar forms).'
              : 'Words show up here once you’ve seen them in a review or lesson.'}
          </p>
          <Button asChild variant="outline">
            <Link to={themeId ? '/themes/$themeId' : '/themes'} params={{ themeId: themeId ?? '' }}>
              Go to themes
            </Link>
          </Button>
        </>
      )}
    </div>
  );
}

type Answer = {
  verdict: AnswerVerdict;
  given?: string;
  expected?: string;
  chosen?: string;
  /** Free check result for `translate` exercises. */
  translation?: TranslationCheck;
};

/** How a free translation check counts in the session (practice only). */
const TRANSLATION_VERDICT: Record<TranslationCheck, AnswerVerdict> = {
  match: 'correct',
  accents: 'accents',
  close: 'typo',
  different: 'wrong',
};

function Session({
  initial,
  mode,
  remaining,
  onNext,
  onPractice,
}: {
  initial: LessonItemDto[];
  mode: LessonMode;
  remaining: number;
  onNext: () => void;
  onPractice: () => void;
}) {
  const queryClient = useQueryClient();
  const { data: me } = useQuery(meQuery);
  const graded = mode === 'due';
  const [queue, setQueue] = useState(initial);
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [stats, setStats] = useState<LessonStats>(emptyStats);
  const shownAt = useRef(Date.now());
  const indexRef = useRef(index);
  indexRef.current = index;
  const item = queue[index];
  const done = !item;
  const autoplay = useRef(readAutoplay());

  /** Shows an exercise again a few exercises later (fresh option order). */
  const repeatLater = useCallback((again: LessonItemDto) => {
    setQueue((q) => {
      const at = Math.min(q.length, indexRef.current + 1 + REPEAT_GAP);
      const copy: LessonItemDto = {
        ...again,
        // A new word seen once on a flashcard comes back as "pick the meaning", if possible.
        kind: again.kind === 'intro' && again.options ? 'choose_meaning' : again.kind,
        key: `${again.key}+`,
        options: again.options ? shuffle(again.options) : null,
      };
      return [...q.slice(0, at), copy, ...q.slice(at)];
    });
  }, []);

  const grade = useMutation({
    mutationFn: (vars: {
      item: LessonItemDto;
      rating: ReviewRatingName;
      responseMs: number;
      answer?: string;
    }) =>
      unwrap(
        api.review.cards[':cardId'].$post({
          param: { cardId: vars.item.card.cardId },
          json: {
            rating: vars.rating,
            exerciseType: exerciseTypeOf(vars.item.kind),
            responseMs: vars.responseMs,
            ...(vars.answer !== undefined ? { answer: vars.answer.slice(0, 200) } : {}),
          },
        }),
      ),
    onSuccess: (result: GradeResultDto, vars) => {
      const { card } = vars.item;
      if (STATUS_RANK[result.status] > STATUS_RANK[card.status]) {
        setStats((s) => ({
          ...s,
          raised: new Map(s.raised).set(card.lexemeId, { card, to: result.status }),
        }));
      }
      // Due again within the session (a learning step): ask again later, with fresh intervals.
      if (result.requeue) repeatLater({ ...vars.item, card: result.requeue });
    },
    onError: (err) => toast.error(`Not saved: ${errorMessage(err)}`),
  });

  const practice = useMutation({
    mutationFn: (vars: { item: LessonItemDto; correct: boolean }) =>
      unwrap(
        api.lessons.practice.$post({
          json: {
            lexemeId: vars.item.card.lexemeId,
            exerciseType: exerciseTypeOf(vars.item.kind),
            correct: vars.correct,
          },
        }),
      ),
    onError: (err) => toast.error(`Not saved: ${errorMessage(err)}`),
  });

  const record = useCallback(
    (current: LessonItemDto, verdict: AnswerVerdict, rating: ReviewRatingName, given?: string) => {
      const responseMs = Date.now() - shownAt.current;
      const right = verdict !== 'wrong';
      setStats((s) => {
        const firstTry = new Map(s.firstTry);
        if (!firstTry.has(current.card.cardId)) firstTry.set(current.card.cardId, right);
        const missed = right
          ? s.missed
          : new Map(s.missed).set(current.card.lexemeId, current.card);
        return { ...s, exercises: s.exercises + 1, firstTry, missed };
      });
      if (graded) {
        grade.mutate({ item: current, rating, responseMs, answer: given });
      } else {
        practice.mutate({ item: current, correct: right });
        // Outside the schedule, a missed word simply comes back once.
        if (!right && !current.key.endsWith('+')) repeatLater(current);
      }
    },
    [graded, grade, practice, repeatLater],
  );

  const next = useCallback(() => {
    setAnswer(null);
    setRevealed(false);
    setIndex((i) => i + 1);
    shownAt.current = Date.now();
  }, []);

  const sayIt = useCallback(
    (lemma: string, lang: string) => {
      if (autoplay.current) speak(lemma, lang, me?.profile.ttsVoice);
    },
    [me?.profile.ttsVoice],
  );

  const choose = (lexemeId: string) => {
    if (!item || answer) return;
    const verdict: AnswerVerdict = lexemeId === item.card.lexemeId ? 'correct' : 'wrong';
    record(
      item,
      verdict,
      ratingFor({ verdict, kind: item.kind, isNew: item.card.isNew }),
      lexemeId === item.card.lexemeId ? item.card.lemma : undefined,
    );
    setAnswer({ verdict, chosen: lexemeId });
    sayIt(item.card.lemma, item.card.lang);
  };

  const build = (words: string[]) => {
    if (!item?.sentence || answer) return;
    const verdict: AnswerVerdict = scrambleCorrect(words, item.sentence.answer, item.card.lang)
      ? 'correct'
      : 'wrong';
    record(item, verdict, ratingFor({ verdict, kind: item.kind }), words.join(' '));
    setAnswer({
      verdict,
      given: words.join(' '),
      expected: `${item.sentence.answer.join(' ')}${item.sentence.end}`,
    });
    sayIt(`${item.sentence.answer.join(' ')}${item.sentence.end}`, item.card.lang);
  };

  const type = (text: string, hinted: boolean) => {
    if (!item || answer) return;
    if (item.kind === 'translate' && item.translate && text.trim()) {
      const check = checkTranslation(text, item.translate.reference, item.card.lang);
      const verdict = TRANSLATION_VERDICT[check];
      record(item, verdict, ratingFor({ verdict, kind: item.kind, hinted }), text);
      setAnswer({ verdict, given: text, expected: item.translate.reference, translation: check });
      sayIt(item.translate.reference, item.card.lang);
      return;
    }
    const target = expectedAnswer(item);
    const check = text.trim()
      ? checkAnswer(text, acceptedAnswers([target]), item.card.lang)
      : { verdict: 'wrong' as const, expected: target };
    const responseMs = Date.now() - shownAt.current;
    const rating = ratingFor({
      verdict: check.verdict,
      kind: item.kind,
      hinted,
      responseMs,
      isNew: item.card.isNew,
    });
    record(item, check.verdict, rating, text);
    setAnswer({ verdict: check.verdict, given: text, expected: check.expected });
    sayIt(item.card.lemma, item.card.lang);
  };

  const rateIntro = useCallback(
    (rating: ReviewRatingName) => {
      if (!item) return;
      record(item, rating === 'again' ? 'wrong' : 'correct', rating);
      next();
    },
    [item, record, next],
  );

  // Keyboard: Enter/Space continues after feedback; the intro card works like a flashcard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!item || e.metaKey || e.ctrlKey || e.altKey) return;
      if (answer && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        next();
        return;
      }
      if (item.kind !== 'intro' || answer) return;
      if ((e.target as HTMLElement | null)?.closest('input, textarea, select')) return;
      if (!revealed && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        setRevealed(true);
      } else if (revealed && RATING_KEYS[e.key]) {
        e.preventDefault();
        rateIntro(RATING_KEYS[e.key] as ReviewRatingName);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [item, answer, revealed, next, rateIntro]);

  useEffect(() => {
    if (item?.kind === 'intro' && autoplay.current && !revealed) {
      speak(item.card.lemma, item.card.lang, me?.profile.ttsVoice);
    }
  }, [item, revealed, me?.profile.ttsVoice]);

  useEffect(() => {
    if (done) {
      void queryClient.invalidateQueries({ queryKey: ['review'] });
      void queryClient.invalidateQueries({ queryKey: ['themes'] });
      void queryClient.invalidateQueries({ queryKey: ['stats'] });
    }
  }, [done, queryClient]);

  if (done) {
    return (
      <LessonSummary
        stats={stats}
        graded={graded}
        remaining={remaining}
        onNext={onNext}
        onPractice={onPractice}
      />
    );
  }

  const progress = (index / queue.length) * 100;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div
          className="h-2 flex-1 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={queue.length}
          aria-valuenow={index}
          aria-label="Lesson progress"
        >
          <div
            className="h-full bg-primary motion-safe:transition-[width]"
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="text-sm text-muted-foreground tabular-nums">
          {index}/{queue.length}
        </span>
      </div>

      {item.kind === 'intro' ? (
        <>
          {item.card.isNew && (
            <p className="text-center text-xs font-medium uppercase tracking-wide text-primary">
              New word
            </p>
          )}
          <Flashcard card={item.card} revealed={revealed} onReveal={() => setRevealed(true)} />
          {revealed ? (
            <RatingBar intervals={item.card.intervals} onRate={rateIntro} />
          ) : (
            <Button className="h-12 w-full text-base" onClick={() => setRevealed(true)}>
              Show answer <span className="hidden text-xs opacity-70 sm:inline">(Space)</span>
            </Button>
          )}
        </>
      ) : (
        <div className="rounded-2xl border bg-flashcard-front p-5 shadow-sm sm:p-6">
          {item.kind === 'build_sentence' ? (
            <SentenceExercise key={item.key} item={item} answered={!!answer} onSubmit={build} />
          ) : item.options ? (
            <ChoiceExercise
              key={item.key}
              item={item}
              chosen={answer?.chosen ?? null}
              onChoose={choose}
            />
          ) : (
            <TypeExercise key={item.key} item={item} answered={!!answer} onSubmit={type} />
          )}
        </div>
      )}

      {answer && (
        <>
          {answer.translation && answer.given ? (
            <TranslationResult item={item} given={answer.given} check={answer.translation} />
          ) : (
            <Feedback
              verdict={answer.verdict}
              card={item.card}
              given={answer.given}
              expected={answer.expected}
            />
          )}
          <Button className="h-12 w-full text-base" onClick={next}>
            Continue <span className="hidden text-xs opacity-70 sm:inline">(Enter)</span>
          </Button>
        </>
      )}
    </div>
  );
}
